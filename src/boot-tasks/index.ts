#!/usr/bin/env node

// boot-tasks: 开机自启的常驻小工具集合,通过子命令切换。
// 每个子命令在 commands/<name>.ts 注册,主入口仅负责 dispatch。
//
// 新增子命令的做法:
//   1. 在 src/boot-tasks/commands/ 下新建 <name>.ts,导出 register(program: Command)
//   2. 在下方 SUBCOMMANDS 数组追加 import + register
//   3. (可选)如果要随 supervisor 一起跑,在 commands/<name>.ts 里 export 一个
//      create<Name>Task(opts): SubTask 工厂,并在 commands/serve.ts 的 buildTasks 里加一个分支
//   4. pnpm run build,在 local/pm2.config.js 调整对应的 app / args

import { Command } from 'commander';
import { registerAwake } from './commands/awake';
import { registerLoadEnv } from './commands/load-env';
import { registerServe } from './commands/serve';

const SUBCOMMANDS: Array<(program: Command) => void> = [
  registerAwake,
  registerLoadEnv,
  registerServe,
];

function main(): void {
  const program = new Command();
  program
    .name('boot-tasks')
    .description('开机自启的常驻小工具集合,每个子命令是一个独立常驻进程,适合 pm2 管理');

  for (const register of SUBCOMMANDS) register(program);

  program.parse(process.argv);
}

main();
