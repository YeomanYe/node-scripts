/**
 * 默认配置常量
 */
export const DEFAULT_TIME = ['9:30', '12:30', '19:00', '23:00'] as const;
export const DEFAULT_MODE = 'once' as const;
export const DEFAULT_COMMANDS: [] = [];

/**
 * 时间常量（毫秒）
 */
export const MS_PER_MINUTE = 60 * 1000;
export const MINUTES_PER_HOUR = 60;
export const MINUTES_PER_DAY = 24 * 60;

/**
 * 解析器支持的文件扩展名
 */
export const JSON_EXTENSIONS = ['.json'];
export const YAML_EXTENSIONS = ['.yml', '.yaml'];
export const SUPPORTED_EXTENSIONS = [
  ...JSON_EXTENSIONS,
  ...YAML_EXTENSIONS
];

/**
 * 默认执行配置
 */
export const DEFAULT_COUNT = { min: 1, max: 1 };
export const DEFAULT_WAIT = { min: 0, max: 0 };
