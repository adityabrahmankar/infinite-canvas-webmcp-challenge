import { Agent } from 'agents';
import type { AgentChatMessage } from '../src/agent-protocol';
import { MAX_AGENT_STEPS, sanitizeConversationHistory } from '../src/agent-protocol';
import type { Env } from './env';
import { AGENT_REQUEST_LIMIT, remainingRequests } from './limits';

export interface CanvasAgentState {
  usedCount: number;
  turnId: string;
  step: number;
  model: string;
  messages: AgentChatMessage[];
}

function usedCountOf(state: CanvasAgentState): number {
  const record = state as CanvasAgentState & { used?: boolean | number };
  if (typeof record.usedCount === 'number' && Number.isFinite(record.usedCount)) {
    return Math.max(0, record.usedCount);
  }
  if (typeof record.used === 'number' && Number.isFinite(record.used)) return Math.max(0, record.used);
  if (record.used === true) return AGENT_REQUEST_LIMIT;
  return 0;
}

export class CanvasAgent extends Agent<Env, CanvasAgentState> {
  initialState: CanvasAgentState = {
    usedCount: 0,
    turnId: '',
    step: 0,
    model: '',
    messages: [],
  };

  async status(unlimited: boolean): Promise<{ remaining: number; used: boolean; unlimited: boolean }> {
    const usedCount = usedCountOf(this.state);
    const remaining = remainingRequests(usedCount, unlimited);
    return {
      remaining,
      used: remaining < 1,
      unlimited,
    };
  }

  async startTurn(
    model: string,
    messages: AgentChatMessage[],
    unlimited: boolean,
    replay = false,
  ): Promise<{ ok: true; turnId: string; step: number; allMessages: AgentChatMessage[] } | { ok: false; error: string; remaining: number }> {
    const usedCount = usedCountOf(this.state);
    if (!unlimited && usedCount >= AGENT_REQUEST_LIMIT) {
      return { ok: false, error: `This visitor already used the ${AGENT_REQUEST_LIMIT} agent requests.`, remaining: 0 };
    }
    const turnId = crypto.randomUUID();
    const history = replay ? [] : sanitizeConversationHistory(this.state.messages || [], 20);
    const allMessages = [...history, ...messages];
    this.setState({
      usedCount: unlimited ? usedCount : usedCount + 1,
      turnId,
      step: 1,
      model,
      messages: allMessages,
    });
    return { ok: true, turnId, step: 1, allMessages };
  }

  async resetChat(): Promise<void> {
    this.setState({
      usedCount: usedCountOf(this.state),
      turnId: '',
      step: 0,
      model: '',
      messages: [],
    });
  }

  async loadTurn(turnId: string): Promise<CanvasAgentState | null> {
    if (!this.state.turnId || this.state.turnId !== turnId) return null;
    return this.state;
  }

  async saveMessages(turnId: string, messages: AgentChatMessage[]): Promise<void> {
    if (this.state.turnId !== turnId) return;
    this.setState({ ...this.state, messages });
  }

  async continueTurn(
    turnId: string,
    messages: AgentChatMessage[],
  ): Promise<{ ok: true; step: number } | { ok: false; error: string }> {
    if (!this.state.turnId || this.state.turnId !== turnId) {
      return { ok: false, error: 'This agent turn is closed.' };
    }
    if (this.state.step >= MAX_AGENT_STEPS) {
      return { ok: false, error: 'Tool loop limit reached for this request.' };
    }
    const step = this.state.step + 1;
    this.setState({ ...this.state, step, messages });
    return { ok: true, step };
  }
}
