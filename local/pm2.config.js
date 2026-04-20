// PM2 ecosystem — 管理 claude-usage / codex-usage 轮询进程
// 用法：
//   pnpm run build
//   pm2 start local/pm2.config.js
//   pm2 save
//   pm2 startup        # 按提示执行 sudo 命令以启用开机自启
const path = require('path');
const root = path.resolve(__dirname, '..');

module.exports = {
  apps: [
    {
      name: 'claude-usage-poll',
      script: 'dist/claude-usage/index.js',
      args: '--poll 300 --config ./local/claude-usage-config.yaml',
      cwd: root,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      out_file: './local/logs/claude-usage.out.log',
      err_file: './local/logs/claude-usage.err.log',
      time: true,
    },
    {
      name: 'codex-usage-poll',
      script: 'dist/codex-usage/index.js',
      args: '--poll 300 --config ./local/codex-usage-config.yaml',
      cwd: root,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      out_file: './local/logs/codex-usage.out.log',
      err_file: './local/logs/codex-usage.err.log',
      time: true,
    },
  ],
};
