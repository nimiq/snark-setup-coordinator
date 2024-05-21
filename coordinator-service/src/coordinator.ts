import {
    ReadonlyCeremony,
    Ceremony,
    Setup,
    SetupParameters,
    ChunkData,
    LockedChunkData,
    Attestation,
    UniqueChunkId,
} from './ceremony'

export interface ChunkInfo {
    parameters: SetupParameters
    uniqueChunkId: UniqueChunkId
    lockHolder: string
}

export interface ChunkDownloadInfo {
    uniqueChunkId: UniqueChunkId
    lockHolder: string
    lastResponseUrl: string
    lastChallengeUrl: string
    previousChallengeUrl: string
}

export interface Coordinator {
    getCeremony(): ReadonlyCeremony
    setCeremony(ceremony: Ceremony): void
    changeKey(oldParticipantId: string, newParticipantId: string): string[]
    getParameters(setupId: string): SetupParameters
    getNumNonContributedChunks(setupId: string, contributorId: string): number
    getLockedChunks(setupId: string, participantId: string): UniqueChunkId[]
    addAttestation(attest: Attestation, participantId: string): void
    getContributorChunks(setupId: string, participantId: string): ChunkInfo[]
    getVerifierChunks(setupId: string): ChunkInfo[]
    getNumChunks(setupId: string): number
    getMaxLocks(): number
    getShutdownSignal(): boolean
    setShutdownSignal(signal: boolean): void
    getRound(): number
    getChunk(uniqueChunkId: UniqueChunkId): LockedChunkData
    getChunkDownloadInfo(uniqueChunkId: UniqueChunkId): ChunkDownloadInfo
    getPhase(): string
    tryLockChunk(uniqueChunkId: UniqueChunkId, participantId: string): boolean
    tryUnlockChunk(uniqueChunkId: UniqueChunkId, participantId: string): boolean
    contributeChunk({
        uniqueChunkId,
        participantId,
        location,
        signedData,
    }: {
        uniqueChunkId: UniqueChunkId
        participantId: string
        location: string
        signedData: object
    }): Promise<void>
}

export interface ChunkStorage {
    getChunkWriteLocation({
        round,
        chunk,
        participantId,
    }: {
        round: number
        chunk: ChunkData
        participantId: string
    })

    moveChunk({
        round,
        chunk,
        participantId,
    }: {
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
