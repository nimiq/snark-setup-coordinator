import fs from 'fs'
import ora from 'ora'
import { ChunkData, SetupParameters } from './ceremony'
import { CeremonyParticipant } from './ceremony-participant'
import { ShellCommand } from './shell-contributor'
import { logger } from './logger'
import { SignedData } from './signed-data'

function sleep(msec): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, msec))
}

export async function worker({
    client,
    contributor,
}: {
    client: CeremonyParticipant
    contributor: (
        parameters: SetupParameters,
        chunk: ChunkData,
    ) => ShellCommand
}): Promise<void> {
    const ui = ora('Starting to contribute...').start()
    const lockBackoffMsecs = 5000
    const ceremony = await client.getCeremony()


    let incompleteChunks = await client.getChunksRemaining()
    while (incompleteChunks.length) {
        const chunk = await client.getLockedChunk()
        const parameters = chunk.parameters
        const setupId = chunk.setupId
        const chunks_length = CeremonyParticipant._getSetup(ceremony, setupId).chunks.length
        const completedChunkCount =
            chunks_length - incompleteChunks.length
        const remainingChunkIds = incompleteChunks.map((chunk) => chunk.chunkId)
        logger.info(
            `completed ${completedChunkCount} / ${chunks_length}`,
        )
        ui.text = `Waiting for an available chunk... Completed ${completedChunkCount} / ${chunks_length}`
        logger.info(`incomplete chunks: %o`, remainingChunkIds)
        if (chunk) {
            ui.text = `Contributing to chunk ${chunk.chunkId}... Completed ${completedChunkCount} / ${chunks_length}`
            logger.info(`locked chunk ${chunk.chunkId}`)
            try {
                // TODO: pull up out of if and handle errors
                const contribute = contributor(parameters, chunk)
                await contribute.load()

                const { contributionPath, result } = await contribute.run()
                const signature = client.auth.signMessage(
                    JSON.stringify(result),
                )
                logger.info(`signing: %s`, JSON.stringify(result))
                const signedContributionData: SignedData = {
                    data: result,
                    signature,
                }
                logger.info(
                    'uploading contribution %s with data %s',
                    contributionPath,
                    JSON.stringify(signedContributionData),
                )
                const content = fs.readFileSync(contributionPath)
                await client.contributeChunk({
                    setupId,
                    chunkId: chunk.chunkId,
                    content,
                    signedData: signedContributionData,
                })

                contribute.cleanup()
            } catch (error) {
                logger.warn(error, 'contributor failed')
                // TODO(sbw)
                // await client.unlockChunk(chunk.chunkId)
            }
        } else {
            logger.info('unable to lock chunk')
        }
        await sleep(lockBackoffMsecs)
        incompleteChunks = await client.getChunksRemaining()
    }

    ui.succeed(`Your contribution was done, thanks for participating!`)
    logger.info('no more chunks remaining')
}
