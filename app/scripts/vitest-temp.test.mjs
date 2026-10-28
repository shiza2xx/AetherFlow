import {it,expect} from 'vitest';
import os from 'node:os';
import path from 'node:path';

it('npm test runs Vitest workers from the explicitly selected temporary root',()=>{
 const expected=process.env.AETHERFLOW_TEST_TEMP_ROOT;
 if(expected)expect(path.resolve(os.tmpdir())).toBe(path.resolve(expected));
});
