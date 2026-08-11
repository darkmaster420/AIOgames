#!/usr/bin/env bash
# Diagnose why JDownloader is not picking up .crawljob files.
#
# Run on the NAS host (TrueNAS: System Settings -> Shell, or over SSH):
#   bash diagnose-jd2.sh
#
# Read-only: it inspects state and writes exactly one probe file into the watch
# folder, which it removes again. Adjust the two paths below if yours differ.

WATCH_HOST_PATH="${WATCH_HOST_PATH:-/mnt/main/downloads/watch}"
APP_CONTAINER="${APP_CONTAINER:-aiogames}"

hr() { printf '\n=== %s ===\n' "$1"; }

hr "1. Watch folder on the host"
ls -land "$WATCH_HOST_PATH" 2>&1
echo "--- contents (crawljobs waiting here mean JD2 is not consuming them) ---"
ls -lan "$WATCH_HOST_PATH" 2>&1 | head -20
echo "--- counts ---"
echo "  .crawljob : $(find "$WATCH_HOST_PATH" -maxdepth 1 -name '*.crawljob' 2>/dev/null | wc -l)"
echo "  .tmp      : $(find "$WATCH_HOST_PATH" -maxdepth 1 -name '*.tmp' 2>/dev/null | wc -l)"

hr "2. ACLs (TrueNAS/ZFS can mask the mode bits)"
getfacl -p "$WATCH_HOST_PATH" 2>&1 | head -30 || echo "getfacl unavailable"
DATASET=$(df --output=source "$WATCH_HOST_PATH" 2>/dev/null | tail -1)
echo "--- dataset: $DATASET ---"
zfs get -H acltype,aclmode,aclinherit "$DATASET" 2>&1 || echo "not a zfs dataset / zfs unavailable"

hr "3. Containers and the users they run as"
docker ps --format '  {{.Names}}\t{{.Image}}\t{{.Status}}' 2>&1
for c in $(docker ps --format '{{.Names}}'); do
  echo "--- $c ---"
  echo "  configured user: '$(docker inspect -f '{{.Config.User}}' "$c" 2>/dev/null)'  (empty = image default)"
  echo "  effective id   : $(docker exec "$c" id 2>/dev/null || echo 'could not exec')"
done

hr "4. How each container sees the watch folder"
for c in $(docker ps --format '{{.Names}}'); do
  MOUNT=$(docker inspect -f '{{range .Mounts}}{{if eq .Source "'"$WATCH_HOST_PATH"'"}}{{.Destination}} ({{if .RW}}rw{{else}}ro{{end}}){{end}}{{end}}' "$c" 2>/dev/null)
  [ -n "$MOUNT" ] && echo "  $c -> $MOUNT"
done
echo "If JD2 is not listed above, it does not have this folder mounted at all,"
echo "which alone explains why it never sees the jobs."

hr "5. JD2's configured watch folders"
echo "JD2 only scans the folders listed in its FolderWatch settings, as JD2 sees"
echo "them. This must match JD2's mount destination from section 4, not the host path."
for c in $(docker ps --format '{{.Names}}'); do
  docker exec "$c" sh -c 'find / -name "*FolderWatchConfig*.json" -not -path "*/proc/*" 2>/dev/null | head -3' 2>/dev/null | while read -r f; do
    [ -n "$f" ] && { echo "--- $c:$f ---"; docker exec "$c" cat "$f" 2>/dev/null | head -20; }
  done
done

hr "6. Can the app actually write there?"
docker exec "$APP_CONTAINER" sh -c '
  d="${JD2_FOLDERWATCH_DIR:-/jd2/folderwatch}"
  echo "  JD2_FOLDERWATCH_DIR=$d"
  [ -d "$d" ] || { echo "  MISSING: not a directory inside the container"; exit 1; }
  t="$d/.probe-$$"
  if echo probe > "$t" 2>/dev/null; then
    echo "  write: OK -> $(ls -lan "$t" | awk "{print \$1, \$3, \$4}")"
    rm -f "$t"
  else
    echo "  write: FAILED (permission denied)"
  fi' 2>&1

hr "Reading this"
cat <<'EOF'
  .crawljob files piling up in section 1  -> JD2 sees the folder but is not
      consuming the jobs. Check section 5: its watch list probably points at a
      different path than where these land.
  Nothing in section 1 and write FAILED in section 6 -> the app cannot write;
      that is a permissions/ACL problem (sections 2 and 3).
  Nothing in section 1 and write OK in section 6 -> jobs are being written and
      removed, so JD2 IS consuming them; the problem is downstream (links stuck
      in the LinkGrabber rather than not detected).
EOF
