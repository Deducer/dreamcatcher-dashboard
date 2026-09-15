// Run inside the existing Postiz container. stdout is a private pipe to the
// dashboard's root-only data directory, never a journal or application log.
const { PrismaClient } = require('/app/node_modules/@prisma/client');
const prisma = new PrismaClient();
(async () => {
    const row = await prisma.integration.findUnique({ where: { id: 'cmr8hyn8r0001o88xfk325mux' }, select: { providerIdentifier: true, internalId: true, token: true, tokenExpiration: true, deletedAt: true, disabled: true, refreshNeeded: true } });
    if (!row || row.deletedAt || row.providerIdentifier !== 'instagram-standalone') throw Error('Expected connection missing');
    process.stdout.write(JSON.stringify({ provider: row.providerIdentifier, accountId: row.internalId, token: row.token, expiresAt: row.tokenExpiration, disabled: row.disabled, refreshNeeded: row.refreshNeeded, syncedAt: new Date().toISOString() }));
})().catch(() => { process.stderr.write('Instagram connection sync failed\n'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
