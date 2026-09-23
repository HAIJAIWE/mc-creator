import { PNG } from 'pngjs';

/**
 * 生成占位符纹理 (16x16 PNG)
 * 用于开发阶段，提供可见的占位纹理而非粉红黑方块
 */

interface TextureOptions {
  width?: number;
  height?: number;
  backgroundColor?: [number, number, number];
  text?: string;
  textColor?: [number, number, number];
}

/**
 * 生成纯色背景 + 文字的 16x16 PNG
 */
export function generatePlaceholderTexture(
  name: string,
  type: 'item' | 'block' | 'entity' | 'gui',
  options: TextureOptions = {},
): Buffer {
  const {
    width = 16,
    height = 16,
    backgroundColor = getTypeColor(type),
    text = name,
    textColor = [255, 255, 255],
  } = options;

  const png = new PNG({ width, height, colorType: 6 }); // RGBA

  // 填充背景色
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) << 2;
      png.data[idx] = backgroundColor[0]; // R
      png.data[idx + 1] = backgroundColor[1]; // G
      png.data[idx + 2] = backgroundColor[2]; // B
      png.data[idx + 3] = 255; // A
    }
  }

  // 简单的文字渲染 (仅作为占位符，实际应用应使用字体渲染)
  // 这里用简单的像素模式模拟文字区域
  drawTextPlaceholder(png, width, height, text);

  return PNG.sync.write(png);
}

/**
 * 根据类型获取默认背景色
 */
function getTypeColor(type: string): [number, number, number] {
  switch (type) {
    case 'item':
      return [70, 130, 180]; // 钢蓝色 - 物品
    case 'block':
      return [139, 69, 19]; // 棕色 - 方块
    case 'entity':
      return [220, 20, 60]; // 深红 - 实体
    case 'gui':
      return [60, 179, 113]; // 中海绿 - GUI
    default:
      return [128, 128, 128]; // 灰色
  }
}

/**
 * 简单的文字占位符绘制 (在 PNG 中绘制一个矩形区域代表文字区域)
 */
function drawTextPlaceholder(png: PNG, width: number, height: number, text: string): void {
  // 在底部绘制一个半透明条带作为文字区域
  const textHeight = Math.min(4, Math.floor(height * 0.3));
  const startY = height - textHeight;

  for (let y = startY; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (png.width * y + x) << 2;
      // 半透明白色条带
      png.data[idx] = 255; // R
      png.data[idx + 1] = 255; // G
      png.data[idx + 2] = 255; // B
      png.data[idx + 3] = 180; // A (半透明)
    }
  }

  // 在左上角画一个小方块表示类型
  const cornerSize = Math.min(4, Math.floor(Math.min(png.width, png.height) * 0.25));
  for (let y = 0; y < cornerSize; y++) {
    for (let x = 0; x < cornerSize; x++) {
      const idx = (png.width * y + x) << 2;
      png.data[idx] = 255;
      png.data[idx + 1] = 255;
      png.data[idx + 2] = 255;
      png.data[idx + 3] = 255;
    }
  }
}

/**
 * 生成物品/方块的占位符纹理文件
 * 返回 FileNode 列表，可直接加入生成结果
 */
export function generatePlaceholderTextures(
  modId: string,
  items: Array<{ id: string; name: string }> = [],
  blocks: Array<{ id: string; name: string }> = [],
): { path: string; content: Buffer }[] {
  const files: { path: string; content: Buffer }[] = [];

  for (const item of items) {
    const texture = generatePlaceholderTexture(item.name, 'item', { text: item.id });
    files.push({
      path: `src/main/resources/assets/${modId}/textures/item/${item.id}.png`,
      content: texture,
    });
  }

  for (const block of blocks) {
    const texture = generatePlaceholderTexture(block.name, 'block', { text: block.id });
    files.push({
      path: `src/main/resources/assets/${modId}/textures/block/${block.id}.png`,
      content: texture,
    });
  }

  return files;
}

/**
 * 生成单个物品/方块的纹理并返回 base64 字符串 (用于预览)
 */
export function generateTextureBase64(
  name: string,
  type: 'item' | 'block' | 'entity' | 'gui',
  options: { width?: number; height?: number } = {},
): string {
  const texture = generatePlaceholderTexture(name, type, options);
  return texture.toString('base64');
}
