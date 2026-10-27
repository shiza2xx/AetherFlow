import path from 'node:path';

/** True when candidate is root or a descendant according to the host filesystem. */
export function isPathWithin(root:string,candidate:string){
 const relative=path.relative(path.resolve(root),path.resolve(candidate));
 return relative===''||(!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith(`..${path.sep}`));
}
