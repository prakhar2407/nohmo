import * as react_jsx_runtime from 'react/jsx-runtime';
import React from 'react';

interface NohmoConfig {
    projectId: string;
    apiKey: string;
    apiUrl: string;
    flushInterval?: number;
    debug?: boolean;
    autoPageView?: boolean;
    autoScrollDepth?: boolean;
    autoTimeSpent?: boolean;
    autoCapture?: boolean;
}
interface NohmoEvent {
    deviceId: string;
    userId: string | null;
    sessionId: string;
    event: string;
    data: Record<string, unknown>;
    page: string;
    referrer: string;
    ts: number;
}
interface NohmoUser {
    userId: string;
    email?: string;
    meta?: Record<string, unknown>;
}
interface NohmoState {
    deviceId: string | null;
    userId: string | null;
    sessionId: string;
    ready: boolean;
}

declare class NohmoTracker {
    private config;
    private state;
    private queue;
    private pageStart;
    private autoCapture;
    constructor(config: NohmoConfig);
    init(): Promise<void>;
    send(event: string, data?: Record<string, unknown>): void;
    linkUser(userId: string, email?: string, meta?: Record<string, unknown>): Promise<void>;
    trackPageView(path?: string): void;
    trackTimeSpent(path?: string): void;
    startScrollTracking(): () => void;
    private sendBatch;
    private generateSessionId;
    private log;
    getState(): NohmoState;
    destroy(): void;
}

interface TrackerSender {
    send(event: string, data?: Record<string, unknown>): void;
}
declare class AutoCapture {
    private tracker;
    private clickCounts;
    private cleanupFns;
    constructor(tracker: TrackerSender);
    start(): void;
    stop(): void;
    private captureClick;
    private captureSubmit;
    private captureInput;
    private getRelevantElement;
    private extractElementProps;
    private getCleanText;
    private getSelector;
}

interface NohmoContextValue {
    tracker: NohmoTracker | null;
    send: (event: string, data?: Record<string, unknown>) => void;
    linkUser: (userId: string, email?: string, meta?: Record<string, unknown>) => Promise<void>;
}
interface NohmoProviderProps {
    children: React.ReactNode;
    projectId: string;
    apiKey: string;
    apiUrl: string;
    options?: Partial<NohmoConfig>;
}
declare function NohmoProvider({ children, projectId, apiKey, apiUrl, options, }: NohmoProviderProps): react_jsx_runtime.JSX.Element;
declare function useNohmo(): NohmoContextValue;

declare function usePageView(path?: string): void;

interface NohmoNextProviderProps {
    children: React.ReactNode;
    projectId: string;
    apiKey: string;
    apiUrl: string;
    options?: Partial<NohmoConfig>;
}
declare function NohmoNextProvider({ children, projectId, apiKey, apiUrl, options, }: NohmoNextProviderProps): react_jsx_runtime.JSX.Element;

export { AutoCapture, NohmoConfig, NohmoEvent, NohmoNextProvider, NohmoProvider, NohmoState, NohmoTracker, NohmoUser, useNohmo, useNohmo as useNohmoNext, usePageView };
