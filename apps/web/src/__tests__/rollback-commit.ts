/**
 * The master commit that a rollback of this deploy runs: the old code of
 * the rollback proof (rollback-safety.test.ts, scripts/legacy-saves/
 * rollback.sh) and of the no-worse-than-master proof
 * (no-worse-than-master.test.tsx, scripts/legacy-saves/no-worse.sh). Both
 * scripts read this line as their default commit.
 *
 * 904bc09 (#71pr) has the same store code as 8187454 (#67pr): between them
 * only a test changed in apps/web/src. Change it, and run both scripts, when
 * this change goes on a newer master.
 */
export const ROLLBACK_COMMIT = "904bc09";
