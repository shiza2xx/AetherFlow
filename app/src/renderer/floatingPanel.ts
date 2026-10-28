export type PanelGeometry={x:number;y:number;width:number;height:number};
export function constrainPanel(value:PanelGeometry,viewport:{width:number;height:number}):PanelGeometry{
 const margin=12,top=52,bottom=38,maxWidth=Math.max(240,viewport.width-margin*2),maxHeight=Math.max(140,viewport.height-top-bottom);
 const width=Math.min(maxWidth,Math.max(Math.min(360,maxWidth),value.width)),height=Math.min(maxHeight,Math.max(Math.min(220,maxHeight),value.height));
 return {width,height,x:Math.max(margin,Math.min(value.x,viewport.width-width-margin)),y:Math.max(top,Math.min(value.y,viewport.height-height-bottom))};
}
export function initialPanel(viewport:{width:number;height:number}):PanelGeometry{return constrainPanel({x:18,y:viewport.height-440,width:640,height:390},viewport);}
