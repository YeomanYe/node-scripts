import fs from 'fs/promises';
import path from 'path';
import yaml from 'yaml';
import { Config } from './types';
import {
  JSON_EXTENSIONS,
  YAML_EXTENSIONS,
  SUPPORTED_EXTENSIONS
} from './constants';

/**
 * 配置解析器接口
 */
export interface ConfigParser {
  /** 支持的文件扩展名 */
  extensions: readonly string[];
  /** 读取配置 */
  read(filePath: string): Promise<Config>;
  /** 写入配置 */
  write(filePath: string, config: Config): Promise<void>;
}

/**
 * JSON 配置解析器
 */
const jsonParser: ConfigParser = {
  extensions: JSON_EXTENSIONS,
  async read(filePath: string): Promise<Config> {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  },
  async write(filePath: string, config: Config): Promise<void> {
    await fs.writeFile(filePath, JSON.stringify(config, null, 2), 'utf8');
  }
};

/**
 * YAML 配置解析器
 */
const yamlParser: ConfigParser = {
  extensions: YAML_EXTENSIONS,
  async read(filePath: string): Promise<Config> {
    const content = await fs.readFile(filePath, 'utf8');
    return yaml.parse(content) as Config;
  },
  async write(filePath: string, config: Config): Promise<void> {
    await fs.writeFile(filePath, yaml.stringify(config), 'utf8');
  }
};

/**
 * 所有可用的解析器
 */
export const parsers: ConfigParser[] = [jsonParser, yamlParser];

/**
 * 根据文件路径获取对应的解析器
 * @param filePath - 配置文件路径
 * @returns 对应的解析器，未找到则返回 undefined
 */
export function getParser(filePath: string): ConfigParser | undefined {
  const ext = path.extname(filePath).toLowerCase();
  return parsers.find(parser => parser.extensions.includes(ext));
}

/**
 * 检查文件扩展名是否支持
 * @param filePath - 文件路径
 * @returns 是否支持
 */
export function isSupported(filePath: string): boolean {
  return SUPPORTED_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
}

/**
 * 获取支持的文件扩展名列表
 * @returns 扩展名字符串
 */
export function getSupportedExtensions(): string {
  return SUPPORTED_EXTENSIONS.join(', ');
}
