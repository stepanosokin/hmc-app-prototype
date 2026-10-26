import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const projectRoot=fileURLToPath(new URL('../',import.meta.url));
export const evidenceRoot=resolve(projectRoot,process.env.HMC_EVIDENCE_ROOT||'../hmc-app-evidence');
export const archiveRoot=ticket=>resolve(evidenceRoot,ticket);
export function historicalPath(name){
    const prefix='docs/evidence/';
    const normalized=name.replaceAll('\\','/');
    return normalized.startsWith(prefix)?resolve(evidenceRoot,normalized.slice(prefix.length)):resolve(projectRoot,name);
}
