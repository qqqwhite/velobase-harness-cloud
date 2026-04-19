/**
 * Runtime Initialization — 运行时一次性初始化入口
 *
 * 由 instrumentation.ts（Next.js 启动时）或 standalone.ts（SERVICE_MODE 启动时）调用。
 * 集中注册所有需要在服务启动时执行的逻辑，避免 route 文件产生顶层副作用。
 */
import { createLogger } from "@/lib/logger";

const log = createLogger("init");
let initialized = false;

export async function initRuntime() {
  if (initialized) return;
  initialized = true;

  log.info("Initializing runtime services...");

  await initToolRegistry();
  await initLarkHandlers();

  log.info("Runtime initialization complete");
}

async function initToolRegistry() {
  const { registerBuiltinTools } = await import("@/server/api/tools");
  registerBuiltinTools();
}

async function initLarkHandlers() {
  try {
    const { onMessage, onCardAction, parseTextContent } = await import("@/lib/lark/event-handler");
    const { getLarkBot, LARK_CHAT_IDS } = await import("@/lib/lark");
    const { generateHourlyReport } = await import("@/workers/processors/conversion-alert/generate-report");
    const { buildMetricsCard } = await import("@/workers/processors/conversion-alert/build-card");
    const { handleSupportCardAction } = await import("@/server/support/handlers/card-action");

    type MessageEventData = Parameters<Parameters<typeof onMessage>[0]>[0];
    type CardActionEventData = Parameters<Parameters<typeof onCardAction>[0]>[0];

    onMessage(async (data: MessageEventData) => {
      const text = parseTextContent(data.message.content);
      const chatId = data.message.chat_id;

      log.info(
        { chatId, senderId: data.sender.sender_id.open_id, text },
        "Received message",
      );

      if (chatId === LARK_CHAT_IDS.CONVERSION_ALERT) {
        try {
          log.info("Generating hourly report on demand");
          const report = await generateHourlyReport({ isDaily: false });
          const card = buildMetricsCard(report, { isDaily: false });
          const bot = getLarkBot();
          await bot.sendCard(chatId, card);
          log.info("Hourly report sent on demand");
        } catch (error) {
          log.error({ error }, "Failed to send hourly report on demand");
        }
      }

      if (chatId === LARK_CHAT_IDS.CONVERSION_ALERT_DAILY) {
        try {
          log.info("Generating daily report on demand");
          const report = await generateHourlyReport({ isDaily: true });
          const card = buildMetricsCard(report, { isDaily: true });
          const bot = getLarkBot();
          await bot.sendCard(chatId, card);
          log.info("Daily report sent on demand");
        } catch (error) {
          log.error({ error }, "Failed to send daily report on demand");
        }
      }
    });

    onCardAction(async (data: CardActionEventData) => {
      const actionValue = data.action.value;

      log.info({ actionValue }, "Processing card action");

      if (actionValue && typeof actionValue === "object" && "ticketId" in actionValue) {
        return handleSupportCardAction(data);
      }

      log.warn({ actionValue }, "Unknown card action");
      return undefined;
    });

    log.info("Lark event handlers registered");
  } catch (error) {
    log.warn({ error }, "Lark handlers not registered (missing config or modules)");
  }
}
