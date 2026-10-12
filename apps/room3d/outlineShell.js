import * as T from 'three';

// 背面外壳描边（inverted hull）：每个描边 mesh 罩一层沿法线外扩的墨色背面壳，
// 每个物件都有完整一圈轮廓线，物件相接处两侧各画各的边。正交相机下外扩量按
// 屏幕像素换算，远近粗细一致。宽度与墨色是全部壳材质共享的 uniform，由编辑器统一驱动。
const shellWidth={value:.024};
const shellInk={value:new T.Color('#3a3542')};
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

function shellMaterial(source){
 if(!source||source.transparent)return hiddenMaterial();
 const cutout=source.map||source.alphaMap;
 const alphaTest=cutout?Math.max(source.alphaTest||0,.05):0;
 const key=(source.map?.uuid||'')+'/'+(source.alphaMap?.uuid||'')+'/'+alphaTest+'/'+source.side;
 let material=materialCache.get(key);
 if(!material){
  material=new T.MeshBasicMaterial({side:T.BackSide,transparent:false,depthWrite:true,toneMapped:false});
  material.map=cutout||null;
  material.alphaTest=alphaTest;
  material.color=shellInk.value;
  material.onBeforeCompile=shader=>{
   shader.uniforms.shellWidth=shellWidth;
   shader.vertexShader='uniform float shellWidth;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed+=objectNormal*shellWidth;');
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
  const shells=mats.map(shellMaterial);
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
