import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

const filePath = process.argv[2];

if (!filePath) {
  console.error("使い方: node test.js ../3D/test-animationn.glb");
  process.exit(1);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const document = await io.read(filePath);
const root = document.getRoot();

const animations = root.listAnimations();

console.log("確認ファイル:", filePath);

if (animations.length === 0) {
  console.log("アニメーションなし");
  process.exit(0);
}

console.log("アニメーションあり");
console.log("アニメーション数:", animations.length);

animations.forEach((animation, index) => {
  console.log(`\n--- Animation ${index} ---`);
  console.log("名前:", animation.getName() || "(名前なし)");

  const channels = animation.listChannels();
  const samplers = animation.listSamplers();

  console.log("チャンネル数:", channels.length);
  console.log("サンプラー数:", samplers.length);

  let maxTime = 0;

  samplers.forEach((sampler) => {
    const input = sampler.getInput();

    if (!input) return;

    const array = input.getArray();

    if (!array) return;

    for (const time of array) {
      if (time > maxTime) {
        maxTime = time;
      }
    }
  });

  console.log("長さ:", maxTime.toFixed(3), "秒");

  if (maxTime > 0) {
    console.log("24fps換算:", Math.round(maxTime * 24), "フレームくらい");
    console.log("30fps換算:", Math.round(maxTime * 30), "フレームくらい");
  }
});