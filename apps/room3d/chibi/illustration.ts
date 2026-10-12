import * as T from 'three';
import { dropShadowUniforms } from './dropShadow';

// A single material pass: retain painted features, cutout hair, skinning and
// garment colours, but replace physical highlights with two painted tones.
// Standalone previews use a fixed illustration light; homes bind their shared
// lighting uniforms and receive the room shadows in the existing material pass.
const originals = new WeakMap<T.MeshStandardMaterial, {
  compile: T.MeshStandardMaterial['onBeforeCompile'];
  cache: T.MeshStandardMaterial['customProgramCacheKey'];
  toneMapped: boolean;
}>();
type RoomLightUniforms = {roomShadeTint:{value:T.Color};roomSunTint:{value:T.Color};roomBrightness:{value:number};roomSunContrast:{value:number}};
const roomTints = new WeakMap<T.MeshStandardMaterial, {value:T.Color}>();
const roomLights = new WeakMap<T.MeshStandardMaterial, {enabled:{value:number}; uniforms:RoomLightUniforms; cel:{value:number}}>();
// 主光方向（视野空间，表面→光），脸部 SDF 阴影的横向扫动阈值用；由家园编辑器每帧刷新。
export const characterLightDirection={value:new T.Vector3(0,0,1)};

export function setCharacterRoomLighting(root:T.Object3D,uniforms:RoomLightUniforms,cel=false){
 root.traverse(object=>{
  if(!(object instanceof T.Mesh))return;
  object.receiveShadow=true;
  for(const material of Array.isArray(object.material)?object.material:[object.material]){
   if(!(material instanceof T.MeshStandardMaterial))continue;
   const room=roomLights.get(material);if(!room)continue;
   const celValue=cel?1:0;
   if(room.uniforms===uniforms){if(room.cel.value!==celValue)room.cel.value=celValue;continue;}
   room.enabled.value=1;room.uniforms=uniforms;room.cel.value=celValue;material.needsUpdate=true;
  }
 });
}

// Keep faces legible while giving all residents the same room colour cast.
// Standalone avatar previews keep a neutral tint.
export function setCharacterRoomTint(root:T.Object3D,color:string){
 root.traverse(object=>{
  if(!(object instanceof T.Mesh))return;
  for(const material of Array.isArray(object.material)?object.material:[object.material]){
   if(!(material instanceof T.MeshStandardMaterial))continue;
   const tint=roomTints.get(material);if(tint)tint.value.set(color);
  }
 });
}

export function setCharacterIllustration(root:T.Object3D, enabled=true) {
  const seen = new Set<T.Material>();
  root.traverse(object => {
    if (!(object instanceof T.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!(material instanceof T.MeshStandardMaterial) || seen.has(material)) continue;
      seen.add(material);
      const original = originals.get(material);
      if (!enabled) {
        if (!original) continue;
        material.onBeforeCompile = original.compile;
        material.customProgramCacheKey = original.cache;
        material.toneMapped = original.toneMapped;
        originals.delete(material);
        roomTints.delete(material);
        roomLights.delete(material);
      } else {
        if (original) continue;
        const saved = {compile:material.onBeforeCompile, cache:material.customProgramCacheKey, toneMapped:material.toneMapped};
        const cacheKey = material.customProgramCacheKey();
        originals.set(material,saved);
        const roomTint={value:new T.Color('#ffffff')};roomTints.set(material,roomTint);
        const room={enabled:{value:0},uniforms:{roomShadeTint:{value:new T.Color('#ffffff')},roomSunTint:{value:new T.Color('#ffffff')},roomBrightness:{value:1},roomSunContrast:{value:0},roomBounceUp:{value:new T.Color('#ffffff')},roomBounceDown:{value:new T.Color('#ffffff')}},cel:{value:0}};roomLights.set(material,room);
        const faceSdf = material.userData.faceSdf as T.Texture | undefined;
        material.toneMapped = false;
        material.onBeforeCompile = (shader,renderer) => {
          saved.compile.call(material,shader,renderer);
          shader.uniforms.characterRoomTint=roomTint;
          shader.uniforms.characterRoomEnabled=room.enabled;
          shader.uniforms.characterCel=room.cel;
          shader.uniforms.dropShadowMask=dropShadowUniforms.mask;
          shader.uniforms.dropShadowScreen=dropShadowUniforms.screen;
          shader.uniforms.dropShadowDrop=dropShadowUniforms.drop;
          shader.uniforms.dropShadowEnabled=dropShadowUniforms.enabled;
          if(faceSdf)shader.uniforms.faceSdfMap={value:faceSdf};
          shader.uniforms.characterLightDirection=characterLightDirection;
          Object.assign(shader.uniforms,room.uniforms);
          shader.fragmentShader='uniform vec3 characterRoomTint;\nuniform float characterRoomEnabled;\nuniform float characterCel;\nuniform sampler2D dropShadowMask;\nuniform vec2 dropShadowScreen;\nuniform vec2 dropShadowDrop;\nuniform float dropShadowEnabled;\n'+(faceSdf?'uniform sampler2D faceSdfMap;\n':'')+'uniform vec3 characterLightDirection;\nuniform vec3 roomShadeTint;\nuniform vec3 roomSunTint;\nuniform float roomBrightness;\nuniform float roomSunContrast;\nuniform vec3 roomBounceUp;\nuniform vec3 roomBounceDown;\n'+shader.fragmentShader;
          shader.fragmentShader = shader.fragmentShader.replace(
            'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;',
            `
            vec3 inkLight = normalize(mat3(viewMatrix) * vec3(-0.45, 0.8, 0.65));
            float inkFacing = dot(normal, inkLight);
            float inkEdge = max(fwidth(inkFacing) * 1.5, 0.012);
            float inkLit = smoothstep(0.12 - inkEdge, 0.12 + inkEdge, inkFacing);
            float inkShade = mix(${material.userData.illustrationFace ? '0.90' : '0.70'}, 1.0, inkLit);
            vec3 inkTint = mix(vec3(0.96, 0.97, 1.0), vec3(1.0), inkLit);
            vec3 inkWeights = vec3(.2126,.7152,.0722);
            vec3 inkSkin = diffuseColor.rgb;
            ${material.userData.illustrationFace || material.userData.illustrationSkin ? `{
              // 卡通档压平贴图自带的静态阴影（腮影/侧影）：中间调按幂律提亮（保序不反色），
              // 五官线稿（极暗像素）与亮部保持不动——明暗交给光照色阶，贴图只留固有色与特征。
              float skinLum = dot(inkSkin,inkWeights);
              float midBand = smoothstep(.16,.26,skinLum)*(1.-smoothstep(.72,.88,skinLum));
              inkSkin = mix(inkSkin,inkSkin*pow(max(skinLum,.001),-.5),midBand*characterCel);
            }` : ''}
            ${material.userData.illustrationHair && material.map ? `{
              // 固有色渐变：发根→发梢的色带（贴图 UV 竖向，v 高为头顶），对应平涂
              // 「涂固有色」环节的分层上色——纯色块升级为有层次的动画质感。
              float rootBand = smoothstep(.45,.7,vMapUv.y);
              float tipBand = 1.-smoothstep(.15,.45,vMapUv.y);
              inkSkin *= mix(vec3(1.),vec3(.92,.91,1.03),rootBand*.34*characterCel);
              inkSkin *= mix(vec3(1.),vec3(1.05,1.0,.94),tipBand*.26*characterCel);
            }` : ''}
            ${(material.userData.illustrationFace || material.userData.illustrationSkin) && material.map ? `{
              // 皮肤固有色微渐变：上亮下微暖，大片肤色不再是一个死色（幅度极轻，不抢腮红）。
              float skinFall = smoothstep(.2,.8,vMapUv.y);
              inkSkin *= mix(vec3(.99,.975,1.005),vec3(1.02,1.01,.985),skinFall*.5*characterCel);
            }` : ''}
            vec3 inkPreview = inkSkin * inkShade * inkTint * characterRoomTint;
            float inkBase = max(dot(inkSkin,inkWeights),.001);
            float inkEnergy = dot(totalDiffuse,inkWeights)/inkBase;
            // directDiffuse includes window occlusion and the actual light direction.
            float inkDirect = dot(reflectedLight.directDiffuse,inkWeights)/inkBase;
            float inkSun = smoothstep(.18,.85,inkDirect);
            float inkRoomShade = mix(${material.userData.illustrationFace ? '.84' : '.68'},1.0,smoothstep(.18,.82,inkEnergy));
            // Toon rooms: binary shading with narrow AA everywhere—the face keeps
            // a higher floor to stay legible, but its light also snaps into two
            // bands instead of a smooth ramp, so faces read flat like the body.
            float celBand = ${material.userData.illustrationFace ? `0.88 + 0.12 * smoothstep(.30,.40,inkEnergy)` : `0.70 + 0.30 * smoothstep(.43,.47,inkEnergy)`};
            inkRoomShade = mix(inkRoomShade, celBand, characterCel);
            inkRoomShade += inkSun * mix(.12,${material.userData.illustrationFace ? '.30' : '.38'},roomSunContrast);
            ${material.userData.faceSdf ? `
            // 脸部 SDF 阴影：距离场由前发部件生成（FbxBody / faceSdf.ts），边界跟随
            // 刘海下缘。阈值随主光横向扫动偏移——光从哪边来，影带向对侧加深；
            // 刘海覆盖区内（含透视缝隙）场值为负，任何阈值下都是影。
            float faceField = texture2D(faceSdfMap, vMapUv).r * 2.0 - 1.0;
            vec3 faceRight = normalize(cross(vec3(0.,1.,0.), normal));
            float faceSweep = clamp(dot(characterLightDirection, faceRight), -1., 1.);
            float faceCut = 0.06 + 0.55 * faceSweep * (0.5 - vMapUv.x);
            float faceAa = max(fwidth(faceField) * 1.5, 0.02);
            float faceShadow = (1.0 - smoothstep(faceCut - faceAa, faceCut + faceAa, faceField)) * characterCel;
            inkRoomShade = mix(inkRoomShade, .80, faceShadow);` : material.userData.illustrationFace || material.userData.illustrationSkin ? `
            // 屏幕空间落影（前发/衣片 → 脸与皮肤）：按主光方向偏移采样剪影蒙版，
            // 命中处直接压进阴影档，颜色随下方的偏色一起换。无 SDF 的脸部走这条兜底。
            float dropMask = dropShadowEnabled > .5
              ? smoothstep(.35,.65,texture2D(dropShadowMask,(gl_FragCoord.xy/dropShadowScreen)+dropShadowDrop).a)
              : 0.0;
            inkRoomShade = mix(inkRoomShade, ${material.userData.illustrationFace ? '.80' : '.78'}, dropMask);` : ''}
            // 漫反射：阴影色按表面朝向混入天空反弹/地面反弹色，别是单一死色。
            vec3 inkWorldN = normalize(vec3(dot(viewMatrix[0].xyz,normal),dot(viewMatrix[1].xyz,normal),dot(viewMatrix[2].xyz,normal)));
            vec3 inkBounce = mix(roomBounceDown,roomBounceUp,inkWorldN.y*.5+.5);
            vec3 inkRoomTint = mix(mix(roomShadeTint,inkBounce,.3),roomSunTint,inkSun);
            vec3 inkRoom = inkSkin * inkRoomShade * inkRoomTint * roomBrightness;
            // 色见本：阴影色各部位不一致——发影偏蓝紫更深、肤色影偏粉、衣身影偏紫；
            // 再按表面朝向混入环境反弹色（与场景阴影同逻辑），阴影不是全画面一个死色。
            float celDepth = clamp((1.0 - inkRoomShade) * 1.6, 0.0, 1.0);
            vec3 inkShadowTint = ${material.userData.illustrationHair ? 'vec3(.90,.83,1.13)' : material.userData.illustrationFace ? 'vec3(.97,.92,1.05)' : 'vec3(.94,.87,1.07)'};
            inkShadowTint = mix(inkShadowTint, inkBounce, .22);
            inkRoom *= mix(vec3(1.0), inkShadowTint, celDepth * characterCel);
            ${material.userData.illustrationFace ? '' : `
            // 边缘光：背向主光一侧的窄硬亮带（脸部不加）。只提亮一档固有色，
            // 不加白不曝；硬边窄带才是 2D 卡通的高光画法。
            float inkBack = 1.0 - smoothstep(-.1,.1,dot(normal, normalize(characterLightDirection)));
            float inkGrazing = 1.0 - abs(dot(normal, normalize(vViewPosition)));
            float inkRim = smoothstep(.68,.73,inkGrazing)*inkBack;
            inkRoom = mix(inkRoom,inkSkin*1.18+vec3(.04),inkRim*characterCel);`}
            vec3 outgoingLight = mix(inkPreview,inkRoom,characterRoomEnabled);
            `,
          );
        };
        material.customProgramCacheKey = () => cacheKey + '-character-illustration-v7-' + (material.userData.illustrationFace ? (material.userData.faceSdf ? 'face-sdf' : 'face') : material.userData.illustrationSkin ? 'skin' : material.userData.illustrationHair ? 'hair' : 'body');
      }
      material.userData.characterIllustration = enabled;
      material.needsUpdate = true;
    }
  });
}
