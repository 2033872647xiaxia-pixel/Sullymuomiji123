import * as T from 'three';
import {FullScreenQuad} from 'three/addons/postprocessing/Pass.js';

// 多级辉光后期：亮部提取 → 逐级降采样模糊（1/2、1/4、1/8）→ 叠加回主画面。
// 小半径级是锐利 bloom；大半径级把灯光池与窗光整片向外渗（diffusion），
// 时段氛围由强度与暖色系数控制。所有 pass 都不带深度，模糊集中在低分辨率。
export function createRoomFinishPass(renderer){
 let texture=null,r2=null,r4=null,r8=null,width=0,height=0;const size=new T.Vector2();
 const vertexShader='varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';
 const extractMaterial=new T.ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,
  uniforms:{source:{value:null}},
  vertexShader,
  fragmentShader:`varying vec2 vUv;uniform sampler2D source;
   vec3 bright(vec2 p){vec3 c=sRGBTransferEOTF(texture2D(source,p)).rgb;return c*smoothstep(.5,.88,max(c.r,max(c.g,c.b)));}
   void main(){gl_FragColor=vec4(bright(vUv),1.);}`});
 const blurMaterial=new T.ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,
  uniforms:{image:{value:null},pixel:{value:new T.Vector2()}},
  vertexShader,
  fragmentShader:`varying vec2 vUv;uniform sampler2D image;uniform vec2 pixel;
   void main(){vec3 c=texture2D(image,vUv).rgb;for(int i=0;i<8;i++){float a=float(i)*6.2831853/8.;c+=texture2D(image,vUv+vec2(cos(a),sin(a))*pixel*2.).rgb;}gl_FragColor=vec4(c/9.,1.);}`});
 const material=new T.ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,
  uniforms:{source:{value:null},r2:{value:null},r4:{value:null},r8:{value:null},glow:{value:.14},warmth:{value:0},veilTop:{value:new T.Color('#dcedff')},veilBottom:{value:new T.Color('#fff2de')},veilAmount:{value:.05}},
  vertexShader,
  fragmentShader:`varying vec2 vUv;uniform sampler2D source;uniform sampler2D r2;uniform sampler2D r4;uniform sampler2D r8;uniform float glow;uniform float warmth;uniform vec3 veilTop;uniform vec3 veilBottom;uniform float veilAmount;
   void main(){vec3 c=sRGBTransferEOTF(texture2D(source,vUv)).rgb;
    // 大半径层权重最高：亮源的光向暗区整片渗开，形成弥漫的氛围底色。
    vec3 bloom=texture2D(r2,vUv).rgb*.32+texture2D(r4,vUv).rgb*.68+texture2D(r8,vUv).rgb*1.15;
    float l=dot(c,vec3(.2126,.7152,.0722));
    c=mix(vec3(l),c,1.04);c=(c-.18)*1.025+.18;
    c+=bloom*glow*(1.-clamp(c,0.,1.)) + vec3(.012,.005,0.)*warmth*smoothstep(.35,.85,l);
    // 分图层叠光感：按时段叠加「天色→地色」的全屏渐变罩（乘性叠色保对比）。
    vec3 veil=mix(veilBottom,veilTop,smoothstep(.15,.85,vUv.y));
    c=mix(c,c*veil,veilAmount);
    gl_FragColor=vec4(max(c,0.),1.);
    #include <colorspace_fragment>
   }`});
 const quad=new FullScreenQuad(material),extractQuad=new FullScreenQuad(extractMaterial),blurQuad=new FullScreenQuad(blurMaterial);
 return {render(phase,lampOn=true){
  renderer.getDrawingBufferSize(size);
  if(width!==size.x||height!==size.y){
   texture?.dispose();r2?.dispose();r4?.dispose();r8?.dispose();width=size.x;height=size.y;
   texture=new T.FramebufferTexture(width,height);texture.colorSpace=T.NoColorSpace;texture.minFilter=texture.magFilter=T.LinearFilter;
   r2=new T.WebGLRenderTarget(Math.ceil(width/2),Math.ceil(height/2),{depthBuffer:false,stencilBuffer:false});
   r4=new T.WebGLRenderTarget(Math.ceil(width/4),Math.ceil(height/4),{depthBuffer:false,stencilBuffer:false});
   r8=new T.WebGLRenderTarget(Math.ceil(width/8),Math.ceil(height/8),{depthBuffer:false,stencilBuffer:false});
   material.uniforms.source.value=extractMaterial.uniforms.source.value=texture;
   material.uniforms.r2.value=r2.texture;material.uniforms.r4.value=r4.texture;material.uniforms.r8.value=r8.texture;
  }
  // 关灯的深夜没有灯光池：辉光收敛到月光水平，色罩换成更浓的深蓝紫。
  const lightsOut=phase==='night'&&!lampOn;
  material.uniforms.glow.value=lightsOut?.26:phase==='sunset'?.42:phase==='night'?.58:phase==='morning'?.26:.14;
  material.uniforms.warmth.value=phase==='sunset'?1:phase==='night'?.55:phase==='morning'?.35:0;
  const veil={morning:['#cfe2ff','#ffe3c2',.1],day:['#dcedff','#fff2de',.05],sunset:['#e6c2f6','#ffc893',.16],night:['#7d90e8','#b8a8d8',.17]}[phase]||['#dcedff','#fff2de',.05];
  if(lightsOut)veil[0]='#4a5aa0',veil[1]='#7a6aa8',veil[2]=.24;
  material.uniforms.veilTop.value.set(veil[0]);material.uniforms.veilBottom.value.set(veil[1]);material.uniforms.veilAmount.value=veil[2];
  renderer.copyFramebufferToTexture(texture);const clear=renderer.autoClear,target=renderer.getRenderTarget();renderer.autoClear=false;
  try{
   renderer.setRenderTarget(r2);extractQuad.render(renderer);
   blurMaterial.uniforms.image.value=r2.texture;blurMaterial.uniforms.pixel.value.set(2/r2.width,2/r2.height);
   renderer.setRenderTarget(r4);blurQuad.render(renderer);
   blurMaterial.uniforms.image.value=r4.texture;blurMaterial.uniforms.pixel.value.set(2/r4.width,2/r4.height);
   renderer.setRenderTarget(r8);blurQuad.render(renderer);
   renderer.setRenderTarget(target);quad.render(renderer);
  }finally{renderer.setRenderTarget(target);renderer.autoClear=clear;}
 },dispose(){texture?.dispose();r2?.dispose();r4?.dispose();r8?.dispose();extractQuad.dispose();blurQuad.dispose();quad.dispose();extractMaterial.dispose();blurMaterial.dispose();material.dispose();}};
}
