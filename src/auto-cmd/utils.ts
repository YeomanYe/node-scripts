// 从数组中随机选择指定数量的元素，并按原始顺序返回
export function getRandomElements<T>(array: T[], min: number, max: number): { elements: T[]; indices: number[] } {
  // 创建索引数组并洗牌
  const indices = Array.from({ length: array.length }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  
  // 确定要选择的元素数量
  const count = Math.floor(Math.random() * (max - min + 1)) + min;
  const actualCount = Math.min(count, array.length);
  
  // 选择前actualCount个索引并按原始顺序排序
  const selectedIndices = indices.slice(0, actualCount).sort((a, b) => a - b);
  
  // 根据排序后的索引获取元素
  const selectedElements = selectedIndices.map(index => array[index]);
  
  return {
    elements: selectedElements,
    indices: selectedIndices
  };
}
