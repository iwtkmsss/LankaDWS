import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getConfig } from '../src/config/config.js'
import { scanFile } from '../src/modules/files/malware-scanner.js'

if (getConfig().MALWARE_SCANNER !== 'clamav') throw new Error('Set MALWARE_SCANNER=clamav for the real-engine check')
const directory = await mkdtemp(join(tmpdir(), 'lankadws-scanner-check-'))
try {
  const clean = join(directory, 'clean.txt')
  const eicar = join(directory, 'eicar.txt')
  await writeFile(clean, 'LankaDWS scanner connectivity check')
  // The harmless standard antivirus test string, never an executable or real malware.
  await writeFile(eicar, ['X5O!P%@AP[4\\PZX54(P^)7CC)7}', '$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join(''))
  if (await scanFile(clean) !== 'CLEAN') throw new Error('Clean sample was not accepted')
  if (await scanFile(eicar) !== 'INFECTED') throw new Error('EICAR was not detected; do not release uploads')
  process.stdout.write('ClamAV: clean sample accepted; EICAR blocked.\n')
} finally {
  await rm(directory, { recursive: true, force: true })
}
