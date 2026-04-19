/**
 * Lark 事件回调 API
 * 配置回调地址: https://example.com/api/lark/webhook
 *
 * 同时处理：
 * 1. 消息事件（im.message.receive_v1）
 * 2. 卡片交互事件（按钮点击）
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import type { MessageEventData, CardActionEventData } from '@/lib/lark/event-handler';

const logger = createLogger('lark-webhook');

// 懒加载注册，避免模块顶层 import 在 next build 期间触发 DB/Redis 连接
let handlersRegistered = false;

async function ensureHandlersRegistered() {
  if (handlersRegistered) return;
  handlersRegistered = true;

  const { onMessage, onCardAction, parseTextContent } = await import('@/lib/lark/event-handler');
  const { getLarkBot, LARK_CHAT_IDS } = await import('@/lib/lark');
  const { generateHourlyReport } = await import('@/workers/processors/conversion-alert/generate-report');
  const { buildMetricsCard } = await import('@/workers/processors/conversion-alert/build-card');
  const { handleSupportCardAction } = await import('@/server/support/handlers/card-action');

  onMessage(async (data: MessageEventData) => {
    const text = parseTextContent(data.message.content);
    const chatId = data.message.chat_id;

    logger.info(
      {
        chatId,
        senderId: data.sender.sender_id.open_id,
        text,
      },
      'Received message'
    );

    if (chatId === LARK_CHAT_IDS.CONVERSION_ALERT) {
      try {
        logger.info('Generating hourly report on demand');
        const report = await generateHourlyReport({ isDaily: false });
        const card = buildMetricsCard(report, { isDaily: false });
        const bot = getLarkBot();
        await bot.sendCard(chatId, card);
        logger.info('Hourly report sent on demand');
      } catch (error) {
        logger.error({ error }, 'Failed to send hourly report on demand');
      }
    }

    if (chatId === LARK_CHAT_IDS.CONVERSION_ALERT_DAILY) {
      try {
        logger.info('Generating daily report on demand');
        const report = await generateHourlyReport({ isDaily: true });
        const card = buildMetricsCard(report, { isDaily: true });
        const bot = getLarkBot();
        await bot.sendCard(chatId, card);
        logger.info('Daily report sent on demand');
      } catch (error) {
        logger.error({ error }, 'Failed to send daily report on demand');
      }
    }
  });

  onCardAction(async (data: CardActionEventData) => {
    const actionValue = data.action.value;

    logger.info({ actionValue }, 'Processing card action');

    if (actionValue && typeof actionValue === 'object' && 'ticketId' in actionValue) {
      return handleSupportCardAction(data);
    }

    logger.warn({ actionValue }, 'Unknown card action');
    return undefined;
  });
}

export async function POST(req: NextRequest) {
  try {
    await ensureHandlersRegistered();

    const { handleEventRequest } = await import('@/lib/lark/event-handler');
    const body: unknown = await req.json();
    const headers: Record<string, string> = {};
    req.headers.forEach((value, key) => {
      headers[key] = value;
    });
    const result = await handleEventRequest(body, headers);
    return NextResponse.json(result);
  } catch (error) {
    logger.error({ error }, 'Failed to handle Lark webhook');
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
