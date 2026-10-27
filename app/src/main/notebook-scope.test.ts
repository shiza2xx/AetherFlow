import {describe,expect,it} from 'vitest';
import {NotebookScope} from './notebook-scope';

describe('Notebook store-instance scope',()=>{
 it('invalidates queued requests when the active workspace instance changes, even at the same path',()=>{const scope=new NotebookScope(),captured=scope.current();expect(scope.accepts(captured)).toBe(true);const reopened=scope.rotate();expect(reopened).not.toBe(captured);expect(scope.accepts(captured)).toBe(false);expect(scope.accepts(reopened)).toBe(true);});
});
