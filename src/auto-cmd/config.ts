import fs from 'fs/promises';
import path from 'path';
import { Config } from './types';
import { DEFAULT_TIME, DEFAULT_MODE, DEFAULT_COMMANDS } from './constants';
import { getParser, isSupported, getSupportedExtensions } from './parsers';

let CONFIG_PATH = path.join(process.cwd(), 'local/auto-cmd-config.json');

export function setConfigPath(configPath: string): void {
  console.log(`[Auto-Cmd Config] 步骤: 设置配置文件路径`);
  console.log(`[Auto-Cmd Config] 配置信息: configPath = ${configPath}`);
  CONFIG_PATH = path.resolve(configPath);
  console.log(`[Auto-Cmd Config] 结果: 配置路径已设置为 ${CONFIG_PATH}`);
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}

function createDefaultConfig(): Config {
  console.log(`[Auto-Cmd Config] 步骤: 创建默认配置`);
  const defaultConfig: Config = {
    time: [...DEFAULT_TIME],
    mode: DEFAULT_MODE,
    commands: [...DEFAULT_COMMANDS]
  };
  console.log(`[Auto-Cmd Config] 结果: 默认配置 = ${JSON.stringify(defaultConfig)}`);
  return defaultConfig;
}

export async function readConfig(): Promise<Config> {
  console.log(`[Auto-Cmd Config] ========== 读取配置文件 ==========`);
  console.log(`[Auto-Cmd Config] 步骤: 从文件系统读取配置`);
  console.log(`[Auto-Cmd Config] 配置信息: 配置文件路径 = ${CONFIG_PATH}`);
  
  try {
    const stats = await fs.stat(CONFIG_PATH);
    console.log(`[Auto-Cmd Config] 文件存在，大小 = ${stats.size} bytes`);
    
    if (stats.size === 0) {
      throw new Error('Config file is empty, using default config');
    }

    if (!isSupported(CONFIG_PATH)) {
      const ext = path.extname(CONFIG_PATH).toLowerCase() || '(none)';
      throw new Error(`Unsupported config file format: ${ext}. Supported formats: ${getSupportedExtensions()}`);
    }
    console.log(`[Auto-Cmd Config] 文件格式检查通过`);

    const parser = getParser(CONFIG_PATH);
    if (!parser) {
      throw new Error(`No parser found for file: ${CONFIG_PATH}`);
    }
    console.log(`[Auto-Cmd Config] 使用解析器读取文件...`);

    const config = await parser.read(CONFIG_PATH);
    console.log(`[Auto-Cmd Config] 结果: 配置读取成功`);
    console.log(`[Auto-Cmd Config]   - time: ${JSON.stringify(config.time)}`);
    console.log(`[Auto-Cmd Config]   - mode: ${config.mode}`);
    console.log(`[Auto-Cmd Config]   - count: ${config.count || '未设置'}`);
    console.log(`[Auto-Cmd Config]   - wait: ${config.wait || '未设置'}`);
    console.log(`[Auto-Cmd Config]   - commands: ${config.commands.length} 个命令组`);
    
    return config;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Auto-Cmd Config] 读取配置失败: ${errorMessage}`);
    console.log(`[Auto-Cmd Config] 步骤: 使用默认配置`);

    const defaultConfig = createDefaultConfig();

    try {
      console.log(`[Auto-Cmd Config] 步骤: 尝试写入默认配置到文件`);
      await updateConfig(defaultConfig);
    } catch {
      console.warn(`[Auto-Cmd Config] 写入默认配置失败，使用内存中的默认配置`);
    }

    console.log(`[Auto-Cmd Config] 结果: 返回默认配置`);
    return defaultConfig;
  }
}

function sanitizeConfig(config: Config): Config {
  console.log(`[Auto-Cmd Config] 步骤: 验证并修正配置字段`);
  const sanitized = {
    time: config.time && config.time.length > 0 ? config.time : [...DEFAULT_TIME],
    mode: config.mode === 'once' || config.mode === 'repeat' ? config.mode : DEFAULT_MODE,
    commands: Array.isArray(config.commands) ? config.commands : [...DEFAULT_COMMANDS]
  };
  console.log(`[Auto-Cmd Config] 结果: 配置字段验证完成`);
  return sanitized;
}

export async function updateConfig(config: Config, _executeCount: number = 0): Promise<void> {
  console.log(`[Auto-Cmd Config] ========== 更新配置文件 ==========`);
  console.log(`[Auto-Cmd Config] 步骤: 将配置写入文件`);
  console.log(`[Auto-Cmd Config] 配置信息:`);
  console.log(`[Auto-Cmd Config]   - 配置文件路径: ${CONFIG_PATH}`);
  console.log(`[Auto-Cmd Config]   - time: ${JSON.stringify(config.time)}`);
  console.log(`[Auto-Cmd Config]   - mode: ${config.mode}`);
  console.log(`[Auto-Cmd Config]   - commands: ${config.commands.length} 个命令组`);
  
  try {
    if (!isSupported(CONFIG_PATH)) {
      const ext = path.extname(CONFIG_PATH).toLowerCase() || '(none)';
      throw new Error(`Unsupported config file format: ${ext}. Supported formats: ${getSupportedExtensions()}`);
    }
    console.log(`[Auto-Cmd Config] 文件格式检查通过`);

    const parser = getParser(CONFIG_PATH);
    if (!parser) {
      throw new Error(`No parser found for file: ${CONFIG_PATH}`);
    }

    const safeConfig = sanitizeConfig(config);
    console.log(`[Auto-Cmd Config] 步骤: 使用解析器写入文件...`);

    await parser.write(CONFIG_PATH, safeConfig);

    console.log(`[Auto-Cmd Config] 结果: 配置文件更新成功`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Auto-Cmd Config] 更新配置失败: ${errorMessage}`);
    console.log(`[Auto-Cmd Config] 步骤: 尝试使用默认配置恢复`);

    try {
      const defaultConfig = createDefaultConfig();
      const parser = getParser(CONFIG_PATH);
      if (parser) {
        await parser.write(CONFIG_PATH, defaultConfig);
      } else {
        await fs.writeFile(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2), 'utf8');
      }
      console.log(`[Auto-Cmd Config] 结果: 已使用默认配置恢复`);
    } catch {
      console.error(`[Auto-Cmd Config] 恢复失败，抛出原始错误`);
      throw error;
    }
  }
}
