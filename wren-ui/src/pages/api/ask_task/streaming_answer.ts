import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ThreadResponseAnswerStatus } from '@/apollo/server/services/askingService';
import { TelemetryEvent } from '@/apollo/server/telemetry/telemetry';
import {
  appendTimingTrace,
  createTimingStep,
  nowMs,
  TimingStep,
} from '@/apollo/server/utils';

const { wrenAIAdaptor, askingService, telemetry } = components;

class ContentMap {
  private contentMap: { [key: string]: string } = {};

  // Method to append (concatenate) content to the map
  public appendContent(key: string, content: string) {
    if (!this.contentMap[key]) {
      this.contentMap[key] = '';
    }
    this.contentMap[key] += content;
  }

  // Method to get content from the map
  public getContent(key: string): string | undefined {
    return this.contentMap[key];
  }

  // Method to remove content from the map
  public remove(key: string) {
    delete this.contentMap[key];
  }
}

const contentMap = new ContentMap();

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const { responseId } = req.query;
  if (!responseId) {
    res.status(400).json({ error: 'responseId is required' });
    return;
  }
  try {
    const response = await askingService.getResponse(Number(responseId));
    if (!response) {
      throw new Error(`Thread response ${responseId} not found`);
    }

    // check response status
    if (
      response.answerDetail?.status !== ThreadResponseAnswerStatus.STREAMING
    ) {
      throw new Error(
        `Thread response ${responseId} is not in streaming status`,
      );
    }

    const queryId = response.answerDetail?.queryId;
    if (!queryId) {
      throw new Error(`Thread response ${responseId} does not have queryId`);
    }

    const timingSteps: TimingStep[] = [
      ...(response.answerDetail?.timingSteps || []),
    ];
    const streamOpenStartedAt = nowMs();
    const stream = await wrenAIAdaptor.streamTextBasedAnswer(queryId);
    const streamStartedAt = nowMs();
    let firstChunkReceived = false;
    let completed = false;
    timingSteps.push(
      createTimingStep('answer.ai_summary_stream_open', streamOpenStartedAt, {
        answerQueryId: queryId,
      }),
    );

    stream.on('data', (chunk) => {
      // pass the chunk directly to the client
      if (!firstChunkReceived) {
        timingSteps.push(
          createTimingStep('answer.ai_summary_first_chunk', streamStartedAt, {
            answerQueryId: queryId,
          }),
        );
        firstChunkReceived = true;
      }
      const chunkString = chunk.toString('utf-8');
      let message = '';
      const match = chunkString.match(/data: {"message":"([\s\S]*?)"}/);
      if (match && match[1]) {
        message = match[1];
      } else {
        console.log(`not able to match: ${chunkString}`);
      }
      contentMap.appendContent(queryId, message);
      res.write(chunk);
    });

    stream.on('end', () => {
      completed = true;
      timingSteps.push(
        createTimingStep('answer.ai_summary_stream_total', streamStartedAt, {
          answerQueryId: queryId,
        }),
      );
      try {
        appendTimingTrace({
          event: 'answer_finished',
          threadResponseId: Number(responseId),
          answerQueryId: queryId,
          question: response.question,
          status: ThreadResponseAnswerStatus.FINISHED,
          steps: timingSteps,
        });
      } catch (error) {
        console.error('Failed to write answer timing trace', error);
      }
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
      askingService
        .changeThreadResponseAnswerDetailStatus(
          Number(responseId),
          ThreadResponseAnswerStatus.FINISHED,
          contentMap.getContent(queryId),
        )
        .then(() => {
          console.log(
            'Thread response answer detail status updated to FINISHED',
          );
          contentMap.remove(queryId);
          telemetry.sendEvent(TelemetryEvent.HOME_ANSWER_QUESTION, {
            question: response.question,
          });
        })
        .catch((error) => {
          console.error(
            'Failed to update thread response answer detail status',
            error,
          );
          contentMap.remove(queryId);
          telemetry.sendEvent(
            TelemetryEvent.HOME_ANSWER_QUESTION,
            {
              question: response.question,
              error: error,
            },
            null,
            false,
          );
        });
    });

    // destroy the stream if the client closes the connection
    req.on('close', () => {
      if (completed) return;
      timingSteps.push(
        createTimingStep('answer.ai_summary_stream_total', streamStartedAt, {
          answerQueryId: queryId,
          interrupted: true,
        }),
      );
      try {
        appendTimingTrace({
          event: 'answer_interrupted',
          threadResponseId: Number(responseId),
          answerQueryId: queryId,
          question: response.question,
          status: ThreadResponseAnswerStatus.INTERRUPTED,
          steps: timingSteps,
        });
      } catch (error) {
        console.error('Failed to write answer timing trace', error);
      }
      stream.destroy();
      askingService
        .changeThreadResponseAnswerDetailStatus(
          Number(responseId),
          ThreadResponseAnswerStatus.INTERRUPTED,
          contentMap.getContent(queryId),
        )
        .then(() => {
          console.log(
            'Thread response answer detail status updated to INTERRUPTED',
          );
          contentMap.remove(queryId);
          telemetry.sendEvent(TelemetryEvent.HOME_ANSWER_QUESTION_INTERRUPTED, {
            question: response.question,
          });
        })
        .catch((error) => {
          console.error(
            'Failed to update thread response answer detail status',
            error,
          );
          contentMap.remove(queryId);
          telemetry.sendEvent(
            TelemetryEvent.HOME_ANSWER_QUESTION_INTERRUPTED,
            {
              question: response.question,
              error: error,
            },
            null,
            false,
          );
        });
    });
  } catch (error) {
    console.error(error);
    res.status(500).end();
  }
}
