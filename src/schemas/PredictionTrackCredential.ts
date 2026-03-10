export interface PredictionTrackCredentialSubject {
  id: string;
  wallet: string;
  platform: string;
  predictionScore: number;
  scoreBreakdown: {
    winRate: number;
    roi: number;
    volume: number;
    sampleSize: number;
    recency: number;
  };
  trackRecord: {
    totalBets: number;
    wins: number;
    losses: number;
    totalVolume: number;
    netPnl: number;
  };
  period: {
    from: string;
    to: string;
  };
  anchorTx?: string;
}

export const PredictionTrackCredentialType = ["VerifiableCredential", "PredictionTrackCredential"] as const;
