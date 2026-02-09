// =====================================================
// AI ASSISTANT API ENDPOINT
// Deploy as Supabase Edge Function or API route
// =====================================================

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// System prompt for the AI coach
const SYSTEM_PROMPT = `You are an expert baseball coach and trainer with decades of experience. You help players of all levels improve their skills, understand techniques, and develop their game.

Your role is to:
- Provide clear, actionable advice on baseball techniques and training
- Explain baseball concepts in an easy-to-understand way
- Suggest specific drills and exercises when appropriate
- Be encouraging and supportive while being honest about what it takes to improve
- Focus on fundamentals, mechanics, and proper form
- Consider safety and injury prevention in all recommendations

Keep your responses:
- Concise but informative (2-4 paragraphs typically)
- Practical and actionable
- Appropriate for players ages 12-18 primarily
- Focused on baseball-specific content

If asked about topics outside of baseball training (nutrition, general fitness, etc.), provide brief, general guidance and remind them to consult with appropriate professionals for detailed advice in those areas.`;

export async function handleAIAssistant(conversationId, userMessage) {
  try {
    // Fetch conversation history
    const { data: messages } = await supabase
      .from('ai_messages')
      .select('role, content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    // Build message history for Claude
    const messageHistory = messages ? messages.map(msg => ({
      role: msg.role,
      content: msg.content
    })) : [];

    // Add new user message
    messageHistory.push({
      role: 'user',
      content: userMessage
    });

    // Call Claude API
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: messageHistory
    });

    // Extract reply
    const reply = response.content[0].text;

    return {
      success: true,
      reply: reply
    };

  } catch (error) {
    console.error('AI Assistant error:', error);
    return {
      success: false,
      error: error.message,
      reply: "I'm sorry, I'm having trouble responding right now. Please try again in a moment."
    };
  }
}

// =====================================================
// EXPRESS.JS ROUTE EXAMPLE
// =====================================================

/*
app.post('/api/ai-assistant', async (req, res) => {
  const { conversationId, message } = req.body;
  
  const result = await handleAIAssistant(conversationId, message);
  
  res.json(result);
});
*/

// =====================================================
// SUPABASE EDGE FUNCTION EXAMPLE
// =====================================================

/*
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const { conversationId, message } = await req.json()
  
  const result = await handleAIAssistant(conversationId, message)
  
  return new Response(
    JSON.stringify(result),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})
*/
