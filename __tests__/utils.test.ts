import { getRandomElements } from '../src/auto-cmd/utils';

describe('getRandomElements', () => {
  it('should return random elements within specified range', () => {
    const array = [1, 2, 3, 4, 5];
    const { elements, indices } = getRandomElements(array, 2, 3);
    
    expect(elements.length).toBeGreaterThanOrEqual(2);
    expect(elements.length).toBeLessThanOrEqual(3);
    expect(indices.length).toBe(elements.length);
    
    // 检查元素是否按原始顺序排列
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1]);
    }
  });

  it('should return all elements if array length is less than min', () => {
    const array = [1, 2];
    const { elements } = getRandomElements(array, 3, 5);
    
    expect(elements.length).toBe(2);
    expect(elements).toEqual(expect.arrayContaining([1, 2]));
  });

  it('should return empty array if input array is empty', () => {
    const array: number[] = [];
    const { elements, indices } = getRandomElements(array, 1, 3);
    
    expect(elements.length).toBe(0);
    expect(indices.length).toBe(0);
  });
});
