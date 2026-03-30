'use client';

import { useState, useRef, useCallback } from 'react';
import { triggerKillSwitch } from '@/lib/api';

type KillState = 'idle' | 'armed' | 'firing' | 'activated' | 'error';

export function KillSwitchButton() {
  const [state, setState] = useState<KillState>('idle');
  const [apiKey, setApiKey] = useState('');
  const [message, setMessage] = useState('');
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = useCallback(async () => {
    if (state === 'idle') {
      // First click: arm
      setState('armed');
      // Auto-disarm after 5 seconds
      resetTimer.current = setTimeout(() => {
        setState('idle');
        setMessage('');
      }, 5000);
      return;
    }

    if (state === 'armed') {
      // Second click: fire
      if (resetTimer.current) {
        clearTimeout(resetTimer.current);
        resetTimer.current = null;
      }

      if (!apiKey.trim()) {
        setMessage('Enter API key first');
        return;
      }

      setState('firing');
      try {
        const result = await triggerKillSwitch(apiKey.trim());
        if (result.success) {
          setState('activated');
          setMessage('Kill switch activated. All positions will be liquidated.');
        } else {
          setState('error');
          setMessage(result.message || 'Kill switch failed');
        }
      } catch (err) {
        setState('error');
        setMessage(err instanceof Error ? err.message : 'Failed to trigger kill switch');
      }
    }
  }, [state, apiKey]);

  const buttonLabel: Record<KillState, string> = {
    idle: 'EMERGENCY KILL SWITCH',
    armed: 'CLICK AGAIN TO CONFIRM',
    firing: 'ACTIVATING...',
    activated: 'KILL SWITCH ACTIVE',
    error: 'FAILED - TRY AGAIN',
  };

  const buttonStyle: Record<KillState, string> = {
    idle: 'bg-red-900 hover:bg-red-800 border-red-700 text-red-100',
    armed: 'bg-red-600 hover:bg-red-500 border-red-400 text-white animate-pulse',
    firing: 'bg-red-700 border-red-500 text-red-200 cursor-wait',
    activated: 'bg-red-800 border-red-500 text-red-200 cursor-default',
    error: 'bg-yellow-900 hover:bg-yellow-800 border-yellow-700 text-yellow-100',
  };

  const handleReset = () => {
    setState('idle');
    setMessage('');
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
      <h2 className="text-sm font-medium text-gray-400 mb-4">Emergency Controls</h2>

      <div className="space-y-3">
        <input
          type="password"
          placeholder="LOCAL_API_SECRET"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-red-700"
          disabled={state === 'firing' || state === 'activated'}
        />

        <button
          onClick={handleClick}
          disabled={state === 'firing' || state === 'activated'}
          className={`w-full py-3 px-4 rounded-lg border-2 font-bold text-sm tracking-wide transition-colors ${buttonStyle[state]}`}
        >
          {buttonLabel[state]}
        </button>

        {message && (
          <p className={`text-xs ${state === 'activated' ? 'text-red-400' : state === 'error' ? 'text-yellow-400' : 'text-gray-400'}`}>
            {message}
          </p>
        )}

        {(state === 'error' || state === 'activated') && (
          <button
            onClick={handleReset}
            className="w-full py-2 px-3 text-xs text-gray-400 hover:text-gray-200 border border-gray-700 rounded transition-colors"
          >
            Reset
          </button>
        )}
      </div>
    </div>
  );
}
