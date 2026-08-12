import { LibraryGame } from './models';
import { normalizeLibraryTitle } from './libraryTitle';

type TrackedGameMatchInput = {
  _id?: unknown;
  title?: string | null;
  originalTitle?: string | null;
  steamName?: string | null;
};

export type LibraryMatch = {
  id: string;
  title: string;
  fileName: string;
  relativePath: string;
  fileSizeBytes?: number | null;
  updatedAt?: Date | string;
};

export async function buildLibraryMatchMap(
  games: TrackedGameMatchInput[],
): Promise<Map<string, LibraryMatch>> {
  const titleKeys = new Set<string>();
  const gameKeys = new Map<string, string[]>();

  for (const game of games) {
    const id = String(game._id || '');
    if (!id) continue;

    const keys = [
      game.steamName,
      game.originalTitle,
      game.title,
    ]
      .map(title => normalizeLibraryTitle(String(title || '')))
      .filter(Boolean);

    const uniqueKeys = [...new Set(keys)];
    if (!uniqueKeys.length) continue;
    gameKeys.set(id, uniqueKeys);
    uniqueKeys.forEach(key => titleKeys.add(key));
  }

  if (!titleKeys.size) return new Map();

  const libraryGames = await LibraryGame.find({
    isActive: true,
    normalizedTitle: { $in: [...titleKeys] },
  })
    .select('_id title fileName relativePath fileSizeBytes updatedAt normalizedTitle')
    .sort({ mtimeMs: -1 })
    .lean();

  const byTitle = new Map<string, typeof libraryGames[number]>();
  for (const libraryGame of libraryGames) {
    if (!byTitle.has(libraryGame.normalizedTitle)) {
      byTitle.set(libraryGame.normalizedTitle, libraryGame);
    }
  }

  const matches = new Map<string, LibraryMatch>();
  for (const [gameId, keys] of gameKeys) {
    const match = keys.map(key => byTitle.get(key)).find(Boolean);
    if (!match) continue;
    matches.set(gameId, {
      id: String(match._id),
      title: match.title,
      fileName: match.fileName,
      relativePath: match.relativePath,
      fileSizeBytes: match.fileSizeBytes,
      updatedAt: match.updatedAt,
    });
  }

  return matches;
}
