import { pool } from '../src/db/index.ts';
import { runTestArtifactsCleanup } from '../src/db/testCleanup.ts';

async function main() {
  const execute = process.argv.includes('--execute');
  const report = await runTestArtifactsCleanup({ execute });
  console.log(JSON.stringify(report, null, 2));
  await pool.end();
}

main().catch((err) => {
  console.error('Cleanup script failed:', err);
  process.exit(1);
});
