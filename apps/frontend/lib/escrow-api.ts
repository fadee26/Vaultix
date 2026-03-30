import { ICondition, IEscrowExtended } from '@/types/escrow';

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '') ?? '';

const buildApiUrl = (path: string) => {
  if (apiBaseUrl) {
    return `${apiBaseUrl}${path}`;
  }

  return `/api${path}`;
};

const readErrorMessage = async (response: Response) => {
  const fallback = `Request failed with status ${response.status}`;

  try {
    const data = (await response.json()) as { message?: string | string[] };

    if (Array.isArray(data.message)) {
      return data.message.join(', ');
    }

    return data.message ?? fallback;
  } catch {
    return fallback;
  }
};

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(buildApiUrl(path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
};

export const fetchEscrow = (id: string) =>
  request<IEscrowExtended>(`/escrows/${id}`);

export const acceptPartyInvitation = (escrowId: string, partyId: string) =>
  request(`/escrows/${escrowId}/parties/${partyId}/accept`, {
    method: 'POST',
  });

export const rejectPartyInvitation = (escrowId: string, partyId: string) =>
  request(`/escrows/${escrowId}/parties/${partyId}/reject`, {
    method: 'POST',
  });

export const fulfillCondition = (
  escrowId: string,
  conditionId: string,
  payload: { notes?: string; evidence?: string },
) =>
  request<ICondition>(`/escrows/${escrowId}/conditions/${conditionId}/fulfill`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const confirmCondition = (escrowId: string, conditionId: string) =>
  request<ICondition>(`/escrows/${escrowId}/conditions/${conditionId}/confirm`, {
    method: 'POST',
  });
