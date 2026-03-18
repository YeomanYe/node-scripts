#!/usr/bin/env node

import { Command } from 'commander';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface DirectoryNode {
  path: string;
  depth: number;
  children: DirectoryNode[];
}

function buildDirectoryTree(rootPath: string, maxDepth: number, currentDepth: number = 0): DirectoryNode | null {
  if (currentDepth > maxDepth) {
    return null;
  }

  const node: DirectoryNode = {
    path: rootPath,
    depth: currentDepth,
    children: [],
  };

  if (currentDepth < maxDepth) {
    try {
      const entries = fs.readdirSync(rootPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          const childPath = path.join(rootPath, entry.name);
          const childNode = buildDirectoryTree(childPath, maxDepth, currentDepth + 1);
          if (childNode) {
            node.children.push(childNode);
          }
        }
      }
    } catch (error) {
      // 忽略无权限访问的目录
    }
  }

  return node;
}

function collectDirectoriesPostOrder(node: DirectoryNode): DirectoryNode[] {
  const result: DirectoryNode[] = [];

  for (const child of node.children) {
    result.push(...collectDirectoriesPostOrder(child));
  }

  result.push(node);

  return result;
}

function executeCommand(command: string, cwd: string): { success: boolean; output: string } {
  try {
    const output = execSync(command, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { success: true, output };
  } catch (error: unknown) {
    const err = error as { message?: string; stderr?: string; stdout?: string };
    return {
      success: false,
      output: err.stderr || err.stdout || err.message || 'Unknown error',
    };
  }
}

async function run(options: { depth: number; command: string; dryRun: boolean; continueOnError: boolean }) {
  const rootPath = process.cwd();
  const { depth, command: cmd, dryRun, continueOnError } = options;

  console.log(`Root directory: ${rootPath}`);
  console.log(`Max depth: ${depth}`);
  console.log(`Command: ${cmd}`);
  console.log(`Dry run: ${dryRun}`);
  console.log('---');

  const tree = buildDirectoryTree(rootPath, depth);
  if (!tree) {
    console.error('Failed to build directory tree');
    process.exit(1);
  }

  const directories = collectDirectoriesPostOrder(tree);

  let successCount = 0;
  let failCount = 0;

  for (const dir of directories) {
    const relativePath = path.relative(rootPath, dir.path) || '.';
    const depthIndicator = '  '.repeat(dir.depth);

    console.log(`${depthIndicator}[depth ${dir.depth}] ${relativePath}`);

    if (dryRun) {
      console.log(`${depthIndicator}  (dry-run) Would execute: ${cmd}`);
      successCount++;
    } else {
      console.log(`${depthIndicator}  Executing: ${cmd}`);
      const result = executeCommand(cmd, dir.path);

      if (result.success) {
        console.log(`${depthIndicator}  ✓ Success`);
        if (result.output.trim()) {
          console.log(`${depthIndicator}  Output: ${result.output.trim().split('\n').join(`\n${depthIndicator}  `)}`);
        }
        successCount++;
      } else {
        console.log(`${depthIndicator}  ✗ Failed: ${result.output.trim().split('\n').join(`\n${depthIndicator}  `)}`);
        failCount++;
        if (!continueOnError) {
          console.log('\nExecution stopped due to error.');
          break;
        }
      }
    }
  }

  console.log('\n---');
  console.log(`Completed: ${successCount} succeeded, ${failCount} failed`);

  if (failCount > 0) {
    process.exitCode = 1;
  }
}

const program = new Command();

program
  .name('exec-recursive')
  .description('Execute command recursively in subdirectories (depth-first, bottom-up)')
  .version('1.0.0')
  .argument('<command>', 'Command to execute in each directory')
  .option('-d, --depth <number>', 'Maximum recursion depth (0 = current directory only)', '1')
  .option('--dry-run', 'Show what would be executed without actually running', false)
  .option('-c, --continue-on-error', 'Continue execution even if a command fails', false)
  .action(async (command: string, options: { depth: string; dryRun: boolean; continueOnError: boolean }) => {
    const depth = parseInt(options.depth, 10);
    if (isNaN(depth) || depth < 0) {
      console.error('Error: depth must be a non-negative integer');
      process.exit(1);
    }

    await run({
      depth,
      command,
      dryRun: options.dryRun,
      continueOnError: options.continueOnError,
    });
  });

program.parse(process.argv);
