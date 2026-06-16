
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const openAIApiKey = Deno.env.get('OPENAI_API_KEY');

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { fileId, userId } = await req.json();

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Agent 1: Data validation (already done in extraction)
    console.log('Agent 1: Data extraction completed');

    // Agent 2: Pattern matching with historical data
    const { data: transactions } = await supabase
      .from('extracted_transactions')
      .select('*')
      .eq('file_id', fileId);

    const { data: trainingData } = await supabase
      .from('user_category_training_data')
      .select('*')
      .eq('user_id', userId);

    const { data: categoryMaster } = await supabase
      .from('category_master')
      .select('*');

    let autoMappedCount = 0;
    let manualReviewCount = 0;

    for (const transaction of transactions || []) {
      let bestMatch = null;
      let relevancyScore = 0;
      let matchedAgent = 'agent_2';

      // Agent 2: Check against user training patterns
      for (const pattern of trainingData || []) {
        const similarity = calculateSimilarity(
          transaction.description.toLowerCase(),
          pattern.pattern.toLowerCase()
        );

        if (similarity >= 0.7 && similarity > relevancyScore) {
          bestMatch = pattern.preferred_category;
          relevancyScore = similarity;
        }
      }

      // Agent 2: Check against category master keywords
      if (!bestMatch || relevancyScore < 0.8) {
        for (const category of categoryMaster || []) {
          for (const keyword of category.keywords || []) {
            if (transaction.description.toLowerCase().includes(keyword.toLowerCase())) {
              const keywordScore = 0.6; // Base score for keyword match
              if (keywordScore > relevancyScore) {
                bestMatch = category.name;
                relevancyScore = keywordScore;
                matchedAgent = 'agent_2_keywords';
              }
            }
          }
        }
      }

      // Agent 3: Use Gemini for low confidence transactions
      let geminiFallbackUsed = false;
      if (!bestMatch || relevancyScore < 0.7) {
        try {
          const geminiSuggestion = await getGeminiCategorySuggestion(
            transaction.description,
            categoryMaster || []
          );
          
          if (geminiSuggestion) {
            bestMatch = geminiSuggestion.category;
            relevancyScore = Math.max(relevancyScore, 0.6);
            matchedAgent = 'agent_3_gemini';
            geminiFallbackUsed = true;

            // Store Gemini suggestion
            await supabase
              .from('gemini_suggestions')
              .insert({
                transaction_id: transaction.id,
                description: transaction.description,
                suggested_category: geminiSuggestion.category,
                confidence: geminiSuggestion.confidence,
                keywords: geminiSuggestion.keywords || []
              });
          }
        } catch (error) {
          console.error('Gemini API error:', error);
        }
      }

      // Store categorization result
      const userApproved = relevancyScore >= 0.9;
      const requiresReview = !userApproved;

      await supabase
        .from('auto_categorization_results')
        .insert({
          transaction_id: transaction.id,
          matched_pattern: bestMatch ? transaction.description : null,
          suggested_category: bestMatch,
          matched_agent: matchedAgent,
          relevancy_score: relevancyScore,
          final_category: bestMatch,
          user_approved: userApproved,
          gemini_fallback_used: geminiFallbackUsed
        });

      if (userApproved) {
        autoMappedCount++;
      } else {
        manualReviewCount++;
      }
    }

    // Update import session with results
    await supabase
      .from('import_sessions')
      .update({
        processing_status: 'completed',
        agent1_completed: true,
        agent2_completed: true,
        agent3_completed: true,
        auto_mapped_count: autoMappedCount,
        manual_mapped_count: manualReviewCount
      })
      .eq('id', fileId);

    return new Response(JSON.stringify({
      success: true,
      autoMappedCount,
      manualReviewCount,
      totalTransactions: transactions?.length || 0
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in ai-categorize-transactions:', error);
    return new Response(JSON.stringify({ 
      error: error.message,
      success: false 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function calculateSimilarity(str1: string, str2: string): number {
  const words1 = str1.split(/\s+/);
  const words2 = str2.split(/\s+/);
  
  let matchCount = 0;
  for (const word1 of words1) {
    for (const word2 of words2) {
      if (word1.includes(word2) || word2.includes(word1)) {
        matchCount++;
        break;
      }
    }
  }
  
  return matchCount / Math.max(words1.length, words2.length);
}

async function getGeminiCategorySuggestion(
  description: string,
  categories: any[]
): Promise<{ category: string; confidence: number; keywords?: string[] } | null> {
  if (!openAIApiKey) {
    return null;
  }

  const categoryNames = categories.map(c => c.name).join(', ');
  
  const prompt = `Given this transaction description: "${description}"
  
Available categories: ${categoryNames}

Please suggest the most appropriate category for this transaction. Consider common spending patterns and transaction types.

Respond with only the category name from the list above that best matches this transaction.`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAIApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a financial categorization expert. Always respond with just the category name, nothing else.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 50,
        temperature: 0.1
      }),
    });

    const data = await response.json();
    const suggestedCategory = data.choices[0].message.content.trim();
    
    // Validate that the suggested category exists in our list
    const validCategory = categories.find(c => 
      c.name.toLowerCase() === suggestedCategory.toLowerCase()
    );

    if (validCategory) {
      return {
        category: validCategory.name,
        confidence: 0.7,
        keywords: [description.split(' ')[0]] // Simple keyword extraction
      };
    }

    return null;
  } catch (error) {
    console.error('OpenAI API error:', error);
    return null;
  }
}
