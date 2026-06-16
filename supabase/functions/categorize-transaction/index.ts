
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { description, userCategories, userId } = await req.json();

    if (!geminiApiKey) {
      return new Response(
        JSON.stringify({ error: 'Gemini API key not configured' }), 
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user's historical transaction patterns
    const { data: historicalTransactions } = await supabase
      .from('transactions')
      .select('description, category_id')
      .eq('user_id', userId)
      .limit(50);

    // Create context for Gemini
    const categoryList = userCategories.map((cat: any) => `${cat.name} (${cat.emoji})`).join(', ');
    const historicalContext = historicalTransactions?.map((t: any) => {
      const category = userCategories.find((c: any) => c.id === t.category_id);
      return `"${t.description}" -> ${category?.name || 'Unknown'}`;
    }).join('\n') || '';

    const prompt = `You are a financial transaction categorizer. Based on the user's spending patterns and available categories, suggest the most appropriate category for this transaction.

Available categories: ${categoryList}

User's historical patterns:
${historicalContext}

Transaction description: "${description}"

Please respond with ONLY the category name that best matches this transaction. Consider:
1. The user's historical spending patterns
2. Common words and patterns in transaction descriptions
3. The most logical category for this type of expense

Category name:`;

    // Call Gemini API
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 50,
        }
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const suggestedCategoryName = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    // Find the matching category
    const suggestedCategory = userCategories.find((cat: any) => 
      cat.name.toLowerCase() === suggestedCategoryName?.toLowerCase()
    );

    // Calculate confidence score based on historical matches
    let confidenceScore = 0.5; // Base confidence
    if (historicalTransactions && historicalTransactions.length > 0) {
      const similarTransactions = historicalTransactions.filter((t: any) => 
        t.description.toLowerCase().includes(description.toLowerCase().split(' ')[0]) ||
        description.toLowerCase().includes(t.description.toLowerCase().split(' ')[0])
      );
      confidenceScore = Math.min(0.95, 0.5 + (similarTransactions.length * 0.1));
    }

    return new Response(JSON.stringify({
      suggestedCategoryId: suggestedCategory?.id || userCategories[0]?.id,
      suggestedCategoryName: suggestedCategory?.name || userCategories[0]?.name,
      confidenceScore,
      reasoning: `Based on transaction description and historical patterns`
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in categorize-transaction function:', error);
    return new Response(JSON.stringify({ 
      error: error.message,
      suggestedCategoryId: null,
      confidenceScore: 0 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
