import type { BetweenConfig } from '../core/config-schema'
import type { ChatTransport } from './transport'
import { EchoTransport } from './echo-transport'
import { TelegramTransport } from './telegram-transport'
import { DiscordTransport } from './discord-transport'
import { DiscordPollTransport } from './discord-poll-transport'

/**
 * Select a chat transport from config (`gateway_channel`) + env. Tokens prefer the env var
 * (`BETWEEN_TELEGRAM_TOKEN` / `BETWEEN_DISCORD_TOKEN`) over config.yaml. Throws a clear error
 * when a live channel is selected without a token, so onboarding can guide the user.
 */
export function createChatTransport(
  config: BetweenConfig,
  env: NodeJS.ProcessEnv = process.env,
): ChatTransport {
  switch (config.gateway_channel) {
    case 'telegram': {
      const token = env.BETWEEN_TELEGRAM_TOKEN || config.telegram_bot_token
      if (!token) {
        throw new Error(
          'gateway_channel=telegram but no token — set telegram_bot_token in config.yaml or BETWEEN_TELEGRAM_TOKEN',
        )
      }
      return new TelegramTransport(token)
    }
    case 'discord': {
      const token = env.BETWEEN_DISCORD_TOKEN || config.discord_bot_token
      if (!token) {
        throw new Error(
          'gateway_channel=discord but no token — set discord_bot_token in config.yaml or BETWEEN_DISCORD_TOKEN',
        )
      }
      if (config.discord_mode === 'poll') {
        if (!config.discord_channel_id) {
          throw new Error('discord_mode=poll requires discord_channel_id in config.yaml')
        }
        return new DiscordPollTransport(
          token,
          config.discord_channel_id,
          config.discord_poll_interval_ms,
        )
      }
      return new DiscordTransport(token)
    }
    default:
      return new EchoTransport()
  }
}
