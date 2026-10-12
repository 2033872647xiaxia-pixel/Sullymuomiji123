import * as T from 'three';

// 外壳描边（inverted hull），全场景统一为几何实线：
// 实体（身体、家具、宠物）罩一层沿法线外扩的墨色背面壳；无厚度薄片（发片、
// 帘幔这类双面网格）背面外壳几乎不出线，改挂「围绕几何中心等比放大」的墨色
// 薄片壳，并用深度偏移退到原片后面——只露出一圈轮廓边，镂空处天然形成内描边。
// 两种壳同一墨色、同一宽度 uniform（正交相机按屏幕像素换算），缩放画面时
// 粗细一致；部件级笔触宽度——头发线粗、脸线细、其余标准。
const shellWidth={value:.024};
const shellInk={value:new T.Color('#2b2533')};
const materialCache=new Map();
let hidden=null;

// 透明件（玻璃、纱帘）不画壳；材质数组里的透明组用全丢弃的占位材质保持分组对齐。
function hiddenMaterial(){
 if(!hidden){
  hidden=new T.MeshBasicMaterial({alphaTest:1,transparent:false,toneMapped:false});
  hidden.color.set(0);
 }
 return hidden;
}

function shellScale(source){
 if(!source)return 1;
 if(source.userData?.illustrationHair)return 1.45;
 if(source.userData?.illustrationFace)return .72;
 return 1;
}

function baseShellMaterial(source){
 const cutout=source.map||source.alphaMap;
 const alphaTest=cutout?Math.max(source.alphaTest||0,.05):0;
 const material=new T.MeshBasicMaterial({side:T.BackSide,transparent:false,depthWrite:true,toneMapped:false});
 material.map=cutout||null;
 material.alphaTest=alphaTest;
 material.color=shellInk.value;
 return material;
}

// 实体壳：沿法线外扩，材质按贴图/剔除/笔触共享缓存。
function solidShellMaterial(source){
 if(!source||source.transparent)return hiddenMaterial();
 const scale=shellScale(source);
 const key='solid/'+(source.map?.uuid||'')+'/'+(source.alphaMap?.uuid||'')+'/'+source.side+'/'+scale.toFixed(2);
 let material=materialCache.get(key);
 if(!material){
  material=baseShellMaterial(source);
  material.onBeforeCompile=shader=>{
   shader.uniforms.shellWidth=shellWidth;
   // MeshBasicMaterial 的顶点着色器没有光照材质的 objectNormal chunk，
   // 直接用顶点 normal attribute；注入点在蒙皮 chunk 之前，外扩顶点随骨骼变换。
   shader.vertexShader='uniform float shellWidth;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed+=normal*shellWidth*'+scale.toFixed(2)+';');
  };
  material.customProgramCacheKey=()=>'outline-shell/'+key;
  materialCache.set(key,material);
 }
 return material;
}

// 薄片壳：围绕几何包围盒中心等比放大（放大率按几何半径归一，任何薄片统一边宽）。
// 中心与半径烧进着色器常量，材质按几何缓存；深度偏移让壳退到原片后面只露边缘。
function thinShellMaterial(source,geometry){
 if(!source||source.transparent)return hiddenMaterial();
 const scale=shellScale(source);
 const key='thin/'+geometry.uuid+'/'+(source.map?.uuid||'')+'/'+(source.alphaMap?.uuid||'')+'/'+scale.toFixed(2);
 let material=materialCache.get(key);
 if(!material){
  geometry.computeBoundingBox();
  const box=geometry.boundingBox;
  if(!box||box.isEmpty())return hiddenMaterial();
  const center=box.getCenter(new T.Vector3());
  const radius=Math.max(box.max.x-box.min.x,box.max.y-box.min.y,box.max.z-box.min.z)*.5||1;
  material=baseShellMaterial(source);
  material.side=T.DoubleSide;
  material.polygonOffset=true;material.polygonOffsetFactor=1;material.polygonOffsetUnits=1;
  const c='vec3('+center.x.toFixed(4)+','+center.y.toFixed(4)+','+center.z.toFixed(4)+')';
  material.onBeforeCompile=shader=>{
   shader.uniforms.shellWidth=shellWidth;
   shader.vertexShader='uniform float shellWidth;\n'+shader.vertexShader.replace('#include <begin_vertex>',
    '#include <begin_vertex>\ntransformed='+c+'+(transformed-'+c+')*(1.0+shellWidth*'+(1/radius).toFixed(4)+'*'+scale.toFixed(2)+');');
  };
  material.customProgramCacheKey=()=>'outline-shell/'+key;
  materialCache.set(key,material);
 }
 return material;
}

// 幂等：同一根节点只处理一次（家具 rebuild 会生成新对象，标记随对象走）。
// 蒙皮部件复制骨骼绑定，壳跟随动作；壳作为原 mesh 的子节点，本地矩阵为单位阵。
export function addOutlineShells(root){
 if(!root||root.userData.outlineShells)return;
 root.userData.outlineShells=true;
 root.traverse(o=>{
  if(!o.isMesh||o.userData.outlineShell)return;
  const mats=Array.isArray(o.material)?o.material:[o.material];
  if(!mats.length||mats.every(m=>!m))return;
  // 全双面材质视为无厚度薄片（发片、帘幔）；透明组仍跳过。
  const thin=mats.length>0&&mats.every(m=>m&&m.side===T.DoubleSide);
  const shells=mats.map(m=>thin?thinShellMaterial(m,o.geometry):solidShellMaterial(m));
  if(shells.every(m=>m===hidden))return;
  const material=shells.length>1?shells:shells[0];
  const shell=o.isSkinnedMesh?new T.SkinnedMesh(o.geometry,material):new T.Mesh(o.geometry,material);
  if(o.isSkinnedMesh){shell.skeleton=o.skeleton;shell.bindMatrix.copy(o.bindMatrix);shell.bindMatrixInverse.copy(o.bindMatrixInverse);}
  shell.userData.outlineShell=true;
  shell.matrixAutoUpdate=false;
  o.add(shell);
 });
}

export const outlineShellWidth=shellWidth;
export function disposeOutlineShells(){for(const m of materialCache.values())m.dispose();materialCache.clear();hidden?.dispose();hidden=null;}
