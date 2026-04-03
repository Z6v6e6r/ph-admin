import { Injectable } from '@nestjs/common';
import {
  AiDialogTopic,
  AiSentiment,
  AiUrgency,
  ChatMessage,
  DialogAiInsight
} from '../messenger.types';

@Injectable()
export class AiConnectorService {
  analyzeDialog(threadId: string, messages: ChatMessage[]): DialogAiInsight {
    const text = messages
      .map((message) => String(message.text ?? '').toLowerCase())
      .join(' ');
    const topic = this.detectTopic(text);
    const sentiment = this.detectSentiment(text);
    const urgency = this.detectUrgency(text);
    const confidence = this.detectConfidence(text, topic);
    const qualityScore = this.estimateQualityScore(sentiment, urgency);

    return {
      threadId,
      topic,
      sentiment,
      urgency,
      qualityScore,
      confidence,
      shortSummary: this.buildSummary(topic, sentiment, urgency),
      updatedAt: new Date().toISOString()
    };
  }

  buildSuggestion(insight: DialogAiInsight, clientText: string): string {
    const normalizedText = String(clientText ?? '').trim();
    const prefix =
      insight.urgency === AiUrgency.HIGH
        ? 'Thank you for the message. We marked this as high priority.'
        : 'Thank you for the message.';

    const topicPart = this.topicSuggestion(insight.topic);
    const closure =
      insight.urgency === AiUrgency.HIGH
        ? 'A specialist will join shortly.'
        : 'Please share any extra details if needed.';

    return `${prefix} ${topicPart} ${closure} Context: "${normalizedText}"`;
  }

  canAutoReply(insight: DialogAiInsight): boolean {
    if (insight.urgency === AiUrgency.HIGH) {
      return false;
    }
    return insight.confidence >= 0.65;
  }

  private detectTopic(text: string): AiDialogTopic {
    if (this.includesAny(text, ['payment', 'pay', 'invoice', 'refund'])) {
      return AiDialogTopic.PAYMENT;
    }
    if (this.includesAny(text, ['book', 'booking', 'reserve', 'slot'])) {
      return AiDialogTopic.BOOKING;
    }
    if (this.includesAny(text, ['schedule', 'time', 'date', 'reschedule'])) {
      return AiDialogTopic.SCHEDULE;
    }
    if (this.includesAny(text, ['error', 'bug', 'broken', 'crash', 'not working'])) {
      return AiDialogTopic.TECHNICAL;
    }
    if (this.includesAny(text, ['complaint', 'bad', 'angry', 'issue', 'problem'])) {
      return AiDialogTopic.COMPLAINT;
    }
    return AiDialogTopic.GENERAL;
  }

  private detectSentiment(text: string): AiSentiment {
    if (this.includesAny(text, ['bad', 'angry', 'upset', 'hate', 'terrible'])) {
      return AiSentiment.NEGATIVE;
    }
    if (this.includesAny(text, ['great', 'thanks', 'good', 'perfect', 'love'])) {
      return AiSentiment.POSITIVE;
    }
    return AiSentiment.NEUTRAL;
  }

  private detectUrgency(text: string): AiUrgency {
    if (this.includesAny(text, ['urgent', 'asap', 'immediately', 'now'])) {
      return AiUrgency.HIGH;
    }
    if (this.includesAny(text, ['today', 'soon', 'quickly'])) {
      return AiUrgency.MEDIUM;
    }
    return AiUrgency.LOW;
  }

  private detectConfidence(text: string, topic: AiDialogTopic): number {
    const minConfidence = 0.55;
    const hasLongContext = text.length >= 80;
    const nonGeneralBoost = topic === AiDialogTopic.GENERAL ? 0 : 0.2;
    const contextBoost = hasLongContext ? 0.15 : 0;
    return Math.min(0.95, minConfidence + nonGeneralBoost + contextBoost);
  }

  private estimateQualityScore(sentiment: AiSentiment, urgency: AiUrgency): number {
    let score = 85;
    if (sentiment === AiSentiment.NEGATIVE) {
      score -= 20;
    }
    if (urgency === AiUrgency.HIGH) {
      score -= 20;
    }
    if (urgency === AiUrgency.MEDIUM) {
      score -= 10;
    }
    return Math.max(0, Math.min(100, score));
  }

  private buildSummary(
    topic: AiDialogTopic,
    sentiment: AiSentiment,
    urgency: AiUrgency
  ): string {
    return `Topic=${topic}; sentiment=${sentiment}; urgency=${urgency}`;
  }

  private topicSuggestion(topic: AiDialogTopic): string {
    switch (topic) {
      case AiDialogTopic.PAYMENT:
        return 'We are checking payment and billing details.';
      case AiDialogTopic.BOOKING:
        return 'We are checking available slots and booking details.';
      case AiDialogTopic.SCHEDULE:
        return 'We are validating schedule and timing options.';
      case AiDialogTopic.TECHNICAL:
        return 'We are checking technical status and diagnostics.';
      case AiDialogTopic.COMPLAINT:
        return 'We are escalating this feedback to the station manager.';
      default:
        return 'We are reviewing your request.';
    }
  }

  private includesAny(text: string, words: string[]): boolean {
    return words.some((word) => text.includes(word));
  }
}
