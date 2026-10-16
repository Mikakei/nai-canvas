// 骰子随机提示词用的标签库（官网用的是前端内置的库，这里自建一份常用标签）

const POOLS: Record<string, string[]> = {
  subject: ['1girl', '1boy', '1girl, solo', '1boy, solo', '2girls', '1girl, 1boy'],
  hair: ['long hair', 'short hair', 'medium hair', 'very long hair', 'twintails', 'ponytail', 'bob cut', 'braid', 'messy hair', 'hair bun', 'side ponytail', 'wavy hair'],
  hairColor: ['black hair', 'white hair', 'silver hair', 'blonde hair', 'brown hair', 'red hair', 'pink hair', 'blue hair', 'purple hair', 'green hair', 'gradient hair', 'streaked hair'],
  eyes: ['blue eyes', 'red eyes', 'green eyes', 'golden eyes', 'purple eyes', 'brown eyes', 'heterochromia', 'grey eyes', 'pink eyes'],
  outfit: ['school uniform', 'hoodie', 'kimono', 'maid', 'armor', 'sundress', 'suit', 'raincoat', 'sweater', 'jacket', 'witch hat, robe', 'sailor collar', 'casual clothes', 'military uniform', 'cheongsam'],
  expression: ['smile', 'light smile', 'serious', 'closed eyes', 'open mouth', 'blush', 'surprised', 'expressionless', 'smirk', 'laughing'],
  pose: ['standing', 'sitting', 'looking at viewer', 'looking back', 'from side', 'from above', 'from below', 'arms up', 'hand on own chest', 'leaning forward', 'walking', 'running', 'lying'],
  scene: ['city', 'street', 'forest', 'beach', 'classroom', 'library', 'rooftop', 'cafe', 'shrine', 'field of flowers', 'night sky', 'snow', 'rain', 'underwater', 'ruins', 'train station', 'bedroom', 'mountain'],
  light: ['sunlight', 'backlighting', 'sunset', 'golden hour', 'neon lights', 'moonlight', 'dramatic lighting', 'soft lighting', 'rim light', 'light particles', 'lens flare', 'dappled sunlight'],
  style: ['cinematic', 'watercolor', 'flat color', 'detailed background', 'depth of field', 'wide shot', 'cowboy shot', 'portrait', 'upper body', 'full body', 'dutch angle', 'chromatic aberration'],
};

/** 按"主体 → 外貌 → 服装 → 表情动作 → 场景 → 光线 → 镜头风格"的顺序随机组合一条提示词 */
export function randomPrompt(rand: () => number = Math.random): string {
  const pick = (k: string) => POOLS[k][Math.floor(rand() * POOLS[k].length)];
  const parts = [pick('subject'), pick('hairColor'), pick('hair'), pick('eyes'), pick('outfit'), pick('expression'), pick('pose'), pick('scene'), pick('light'), pick('style')];
  if (rand() < 0.5) parts.push(pick('light'));
  return [...new Set(parts.join(', ').split(', '))].join(', ');
}

/** 一个角色的随机外貌（多角色时用） */
export function randomCharacter(rand: () => number = Math.random): string {
  const pick = (k: string) => POOLS[k][Math.floor(rand() * POOLS[k].length)];
  return [rand() < 0.5 ? 'girl' : 'boy', pick('hairColor'), pick('hair'), pick('eyes'), pick('outfit'), pick('expression')].join(', ');
}
