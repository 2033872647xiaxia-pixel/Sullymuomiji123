import {expect,it,vi} from 'vitest';
import {createRoomFinishPass} from '../apps/room3d/roomFinishPass.js';

it('blurs the bloom chain at low resolutions, reusing buffers',()=>{
 let width=1170,height=2532,target:any=null;
 const draws:any[]=[],buffers:any[]=[];
 const renderer={autoClear:true,getDrawingBufferSize(v:any){v.set(width,height);},getRenderTarget(){return target;},setRenderTarget(t:any){target=t;if(t&&!buffers.includes(t))buffers.push(t);},copyFramebufferToTexture:vi.fn(),render(mesh:any){draws.push({target,uniforms:mesh.material.uniforms});}};
 const finish=createRoomFinishPass(renderer);finish.render('day');
 // 提取 → 两级降采样模糊 → 合成：全尺寸画面只作为纹理采样，模糊都在低分辨率。
 expect(draws).toHaveLength(4);
 expect(buffers[0]).toMatchObject({width:585,height:1266});
 expect(buffers[1]).toMatchObject({width:293,height:633});
 expect(buffers[2]).toMatchObject({width:147,height:317});
 expect(draws[3].target).toBeNull();
 expect(draws[3].uniforms.source.value.image).toMatchObject({width:1170,height:2532});
 const source=draws[3].uniforms.source.value,disposed=vi.fn();for(const rt of buffers)rt.addEventListener('dispose',disposed);
 finish.render('night');expect(buffers).toHaveLength(3);expect(draws[7].uniforms.source.value).toBe(source);expect(draws[7].uniforms.glow.value).toBe(.58);
 width=2532;height=1170;finish.render('sunset');expect(disposed).toHaveBeenCalledTimes(3);expect(buffers[3]).toMatchObject({width:1266,height:585});expect(buffers[4]).toMatchObject({width:633,height:293});expect(buffers[5]).toMatchObject({width:317,height:147});
 expect(renderer.autoClear).toBe(true);expect(target).toBeNull();finish.dispose();
});

it('restores renderer target and clearing after a failed glow pass',()=>{
 const original={};let target:any=original;
 const renderer={autoClear:true,getDrawingBufferSize(v:any){v.set(300,600);},getRenderTarget(){return target;},setRenderTarget(t:any){target=t;},copyFramebufferToTexture(){},render(){throw Error('render failed');}};
 const finish=createRoomFinishPass(renderer);expect(()=>finish.render('day')).toThrow('render failed');expect(target).toBe(original);expect(renderer.autoClear).toBe(true);finish.dispose();
});
