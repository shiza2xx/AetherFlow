function toHexColor(value:string):string|undefined{
 const trimmed=value.trim(),hex=trimmed.match(/^#([0-9a-f]{6})$/i)?.[1];if(hex)return `#${hex.toLowerCase()}`;
 const channels=trimmed.match(/rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)/i);if(!channels)return undefined;
 return `#${channels.slice(1,4).map(channel=>Math.max(0,Math.min(255,Math.round(Number(channel)))).toString(16).padStart(2,'0')).join('')}`;
}

export function currentTerminalColors():{terminalForeground?:string;terminalBackground?:string}{
 const style=getComputedStyle(document.documentElement),foreground=toHexColor(style.getPropertyValue('--text')),background=toHexColor(style.getPropertyValue('--panel'));
 return{...(foreground?{terminalForeground:foreground}:{}),...(background?{terminalBackground:background}:{})};
}
