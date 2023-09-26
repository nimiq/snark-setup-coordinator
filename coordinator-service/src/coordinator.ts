import {
    ReadonlyCeremony,
    Ceremony,
    Setup,
    SetupParameters,
    ChunkData,
    LockedChunkData,
    Attestation,
} from './ceremony'

export interface ChunkInfo {
    chunkId: string
    lockHolder: string
}

export interface ChunkDownloadInfo {
    chunkId: string
    lockHolder: string
    lastResponseUrl: string
    lastChallengeUrl: string
    previousChallengeUrl: string
}

export interface Coordinator {
    getCeremony(): ReadonlyCeremony
    setCeremony(ceremony: Ceremony): void
    setSetup(version: number, newSetup: Setup): void
    deleteLastSetup(): void
    getParameters(setupId: string): SetupParameters
    getNumNonContributedChunks(setupId: string, contributorId: string): number
    getLockedChunks(setupId: string, participantId: string): string[]
    addAttestation(attest: Attestation, participantId: string): void
    getContributorChunks(setupId: string, participantId: string): ChunkInfo[]
    getVerifierChunks(setupId: string): ChunkInfo[]
    getNumChunks(setupId: string): number
    getMaxLocks(): number
    getShutdownSignal(): boolean
    setShutdownSignal(signal: boolean): void
    getRound(): number
    getChunk(setupId: string, chunkId: string): LockedChunkData
    getChunkDownloadInfo(setupId: string, chunkId: string): ChunkDownloadInfo
    getPhase(): string
    tryLockChunk(setupId: string, chunkId: string, participantId: string): boolean
    tryUnlockChunk(setupId: string, chunkId: string, participantId: string): boolean
    contributeChunk({
        setupId,
        chunkId,
        participantId,
        location,
        signedData,
    }: {
        setupId: string,
        chunkId: string
        participantId: string
        location: string
        signedData: object
    }): Promise<void>
}

export interface ChunkStorage {
    getChunkWriteLocation({
        setupId,
        round,
        chunk,
        participantId,
    }: {
        setupId: string,
        round: number
        chunk: ChunkData
        participantId: string
    })

    copyChunk({
        setupId,
        round,
        chunk,
        participantId,
    }: {
        setupId: string,
        round: number
        chunk: ChunkData
        participantId: string
    }): Promise<string>
}

export function chunkVersion(chunk: ChunkData): number {
    // Generate an number that uniquely identifies the current state of the chunk
    return (
        chunk.contributions.filter((contribution) => contribution.contributorId)
            .length +
        chunk.contributions.filter((contribution) => contribution.verifierId)
            .length
    )
}
