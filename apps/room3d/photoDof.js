import * as T from 'three';
import {FullScreenQuad} from 'three/addons/postprocessing/Pass.js';

// 拍照景深：从屏幕拷贝「成品图」（已含描边、辉光等全部后期），另渲一遍带深度的
// 场景取深度，成品图两级降采样模糊，最后按「像素深度与焦点深度之差」混合清晰
// 与模糊（正交相机深度线性）。仅在拍照模式手动出帧时跑，实时预览同链路。
export function createPhotoDof(renderer,scene,camera){
 let image=null,depthTarget=null,blurA=null,blurB=null,width=0,height=0;const size=new T.Vector2();
 const vertexShader='varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';
 const blurMaterial=new T.ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,
  uniforms:{image:{value:null},pixel:{value:new T.Vector2()}},
  vertexShader,
  fragmentShader:`varying vec2 vUv;uniform sampler2D image;uniform vec2 pixel;
   vec3 fetch(vec2 p){return sRGBTransferEOTF(texture2D(image,p)).rgb;}
   void main(){vec3 c=fetch(vUv);for(int i=0;i<8;i++){float a=float(i)*6.2831853/8.;c+=fetch(vUv+vec2(cos(a),sin(a))*pixel*2.);}gl_FragColor=vec4(c/9.,1.);}`});
 const material=new T.ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,
  uniforms:{image:{value:null},blurred:{value:null},depth:{value:null},focus:{value:8},aperture:{value:1},range:{value:3},near:{value:.1},far:{value:200}},
  vertexShader,
  fragmentShader:`varying vec2 vUv;uniform sampler2D image;uniform sampler2D blurred;uniform sampler2D depth;uniform float focus;uniform float aperture;uniform float range;uniform float near;uniform float far;
   void main(){
    float z=texture2D(depth,vUv).x;
    float d=near+z*(far-near);
    float coc=smoothstep(.15,1.,clamp(abs(d-focus)/max(range,.001),0.,1.))*clamp(aperture,0.,1.);
    vec3 c=mix(sRGBTransferEOTF(texture2D(image,vUv)).rgb,texture2D(blurred,vUv).rgb,coc);
    gl_FragColor=vec4(c,1.);
    #include <colorspace_fragment>
   }`});
 const quad=new FullScreenQuad(material),blurQuad=new FullScreenQuad(blurMaterial);
 return {
  render({focus,aperture,range}){
   renderer.getDrawingBufferSize(size);
   if(width!==size.x||height!==size.y){
    image?.dispose();depthTarget?.dispose();blurA?.dispose();blurB?.dispose();width=size.x;height=size.y;
    image=new T.FramebufferTexture(width,height);image.colorSpace=T.NoColorSpace;image.minFilter=image.magFilter=T.LinearFilter;
    depthTarget=new T.WebGLRenderTarget(width,height,{depthTexture:new T.DepthTexture(width,height)});
    blurA=new T.WebGLRenderTarget(Math.ceil(width/4),Math.ceil(height/4),{depthBuffer:false});
    blurB=new T.WebGLRenderTarget(Math.ceil(width/8),Math.ceil(height/8),{depthBuffer:false});
    material.uniforms.image.value=blurMaterial.uniforms.image.value=image;
    material.uniforms.depth.value=depthTarget.depthTexture;
    material.uniforms.blurred.value=blurB.texture;
   }
   material.uniforms.near.value=camera.near;material.uniforms.far.value=camera.far;
   material.uniforms.focus.value=focus;material.uniforms.aperture.value=aperture;material.uniforms.range.value=range;
   const clear=renderer.autoClear,target=renderer.getRenderTarget();renderer.autoClear=true;
   try{
    renderer.copyFramebufferToTexture(image);
    renderer.setRenderTarget(depthTarget);renderer.render(scene,camera);
    blurMaterial.uniforms.image.value=image;blurMaterial.uniforms.pixel.value.set(2/blurA.width,2/blurA.height);
    renderer.setRenderTarget(blurA);blurQuad.render(renderer);
    blurMaterial.uniforms.image.value=blurA.texture;blurMaterial.uniforms.pixel.value.set(2/blurB.width,2/blurB.height);
    renderer.setRenderTarget(blurB);blurQuad.render(renderer);
    renderer.setRenderTarget(null);quad.render(renderer);
   }finally{renderer.setRenderTarget(target);renderer.autoClear=clear;}
  },
  dispose(){image?.dispose();depthTarget?.dispose();blurA?.dispose();blurB?.dispose();quad.dispose();blurQuad.dispose();blurMaterial.dispose();material.dispose();}
 };
}
