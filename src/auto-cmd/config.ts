import fs from 'fs/promises';
import path from 'path';
import { Config } from './types';
import { DEFAULT_TIME, DEFAULT_MODE, DEFAULT_COMMANDS } from './constants';
import { getParser, isSupported, getSupportedExtensions } from './parsers';

// 配置文件路径
let CONFIG_PATH = path.join(process.cwd(), 'local/auto-cmd-config.json');

/**
 * 设置配置文件路径
 * @param configPath - 配置文件路径
 */
export function setConfigPath(configPath: string): void {
  CONFIG_PATH = path.resolve(configPath);
}

/**
 * 获取配置文件路径
 * @returns 当前配置文件路径
 */
export function getConfigPath(): string {
  return CONFIG_PATH;
}

/**
 * 创建默认配置
 * @returns 默认配置对象
 */
function createDefaultConfig(): Config {
  return {
    time: [...DEFAULT_TIME],
    mode: DEFAULT_MODE,
    commands: [...DEFAULT_COMMANDS]
  };
}

/**
 * 读取配置文件
 * @returns 配置对象，如果读取失败返回默认配置
 */
export async function readConfig(): Promise<Config> {
  try {
    // 检查文件是否存在
    const stats = await fs.stat(CONFIG_PATH);
    if (stats.size === 0) {
      throw new Error('Config file is empty, using default config');
    }

    // 检查是否支持该文件格式
    if (!isSupported(CONFIG_PATH)) {
      const ext = path.extname(CONFIG_PATH).toLowerCase() || '(none)';
      throw new Error(`Unsupported config file format: ${ext}. Supported formats: ${getSupportedExtensions()}`);
    }

    const parser = getParser(CONFIG_PATH);
    if (!parser) {
      throw new Error(`No parser found for file: ${CONFIG_PATH}`);
    }

    return await parser.read(CONFIG_PATH);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Error reading config file: ${errorMessage}`);

    // 如果配置文件不存在或为空，返回默认配置
    const defaultConfig = createDefaultConfig();

    // 尝试写回默认配置，防止配置文件继续为空
    try {
      await updateConfig(defaultConfig);
    } catch {
      // 如果写回也失败，静默忽略，直接返回默认配置
      console.warn('Failed to write default config file, using in-memory default');
    }

    return defaultConfig;
  }
}

/**
 * 确保配置对象具有有效的必填字段
 * @param config - 原始配置对象
 * @returns 安全的配置对象
 */
function sanitizeConfig(config: Config): Config {
  return {
    time: config.time && config.time.length > 0 ? config.time : [...DEFAULT_TIME],
    mode: config.mode === 'once' || config.mode === 'repeat' ? config.mode : DEFAULT_MODE,
    commands: Array.isArray(config.commands) ? config.commands : [...DEFAULT_COMMANDS]
  };
}

/**
 * 更新配置文件
 * @param config - 配置对象
 * @param _executeCount - 已执行命令数量（保留参数以保持 API 兼容性）
 */
export async function updateConfig(config: Config, _executeCount: number = 0): Promise<void> {
  try {
    // 检查是否支持该文件格式
    if (!isSupported(CONFIG_PATH)) {
      const ext = path.extname(CONFIG_PATH).toLowerCase() || '(none)';
      throw new Error(`Unsupported config file format: ${ext}. Supported formats: ${getSupportedExtensions()}`);
    }

    const parser = getParser(CONFIG_PATH);
    if (!parser) {
      throw new Error(`No parser found for file: ${CONFIG_PATH}`);
    }

    // 确保配置文件不会被完全清空，保留基本结构
    const safeConfig = sanitizeConfig(config);

    // 使用解析器的写入方法
    await parser.write(CONFIG_PATH, safeConfig);

    console.log('Config file updated successfully');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Error updating config file: ${errorMessage}`);

    // 尝试使用默认配置恢复
    try {
      const defaultConfig = createDefaultConfig();
      const parser = getParser(CONFIG_PATH);
      if (parser) {
        await parser.write(CONFIG_PATH, defaultConfig);
      } else {
        // 如果没有解析器，使用 JSON 格式
        await fs.writeFile(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2), 'utf8');
      }
      console.log('Recovered with default config');
    } catch {
      // 恢复失败，抛出原始错误
      throw error;
    }
  }
}
