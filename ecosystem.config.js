module.exports = {
  apps: [
    {
      name: 'backend',
      cwd: './backend',
      script: 'src/index.js',
      env: {
        NODE_ENV: 'development',
        PORT: 3000
      }
    },
    {
      name: 'frontend',
      cwd: './frontend',
      script: 'npm',
      args: 'run dev',
      env: {
        NODE_ENV: 'development'
      }
    },
    {
      name: 'aria2c',
      script: 'aria2c',
      args: '--enable-rpc --rpc-listen-all --rpc-secret=aiogames123 --continue=true --dir=/workspaces/AIOgames/downloads',
      autorestart: true
    },
    {
      name: 'qbittorrent',
      script: 'qbittorrent-nox',
      args: '--webui-port=8080',
      autorestart: true
    },
    {
      name: 'jdownloader',
      script: 'java',
      args: '-jar /opt/JDownloader/JDownloader.jar',
      autorestart: true
    }
  ]
}