import { ExpoRequest, ExpoResponse } from 'expo-router/server';

export async function GET(request: ExpoRequest): Promise<ExpoResponse> {
  return ExpoResponse.json({ 
    message: 'API Routes working! Database credentials stay secure here.',
    timestamp: new Date().toISOString()
  });
}
