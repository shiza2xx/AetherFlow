import {expect,it} from 'vitest';
import {removeTerminalProbeReplies} from './terminal-input';

it('removes xterm color and device-attribute probe replies from CLI input',()=>{
 const replies='\u001b[?1;2c\u001b]10;rgb:eaea/f3f3/ffff\u001b\\\u001b]11;rgb:1111/1e1e/3131\u001b\\';
 expect(removeTerminalProbeReplies(replies)).toBe('');
});

it('removes BEL-terminated color replies and supported primary/secondary device replies',()=>{
 const replies='\u001b]10;rgb:abcd/1234/ffff\u0007\u001b]11;rgb:00/111/eeee\u0007\u001b[?62;1;6;7;8;9;15;18;21;22c\u001b[>0;276;0c';
 expect(removeTerminalProbeReplies(replies)).toBe('');
});

it('preserves typed text, arrow-key input, and unfinished query text',()=>{
 const input='hello Привет\u001b[A\u001b]10;?\u001b\\\u001b[?1;2';
 expect(removeTerminalProbeReplies(input)).toBe(input);
});

it('removes only complete replies embedded among normal input',()=>{
 expect(removeTerminalProbeReplies('draft\u001b[?1;2c text\u001b]10;rgb:aa/bb/cc\u0007'))
  .toBe('draft text');
});
