import requests

LLM_API_URL = "http://localhost:1234/v1/chat/completions"

def consult_llm_for_division(parcel_info, strategies):
    """
    Calls the local LLM running in LM Studio (gemma-4-e2b).
    Provides the UP Revenue Code Section 116/117 rules and the generated mathematical strategies.
    Returns the LLM's explanation and its recommended strategy index.
    """
    
    # Format strategies text
    str_text = ""
    for i, strat in enumerate(strategies):
        str_text += f"\nStrategy {i+1}: {strat['name']}\n"
        stats = strat.get("sub_plot_stats", [])
        for j, poly in enumerate(strat['polys']):
            frontage = stats[j]["frontage_m"] if j < len(stats) else 0
            river_frontage = stats[j].get("river_frontage_m", 0) if j < len(stats) else 0
            feats = stats[j]["features"] if j < len(stats) else 0
            str_text += f"  - Sub-Plot {j+1}: Area = {poly.area:.1f} sqm, Perimeter = {poly.length:.1f} m, Road Frontage = {frontage:.1f} m, River Frontage = {river_frontage:.1f} m, Features Inside = {feats}\n"
    system_prompt = """You are an expert Indian land revenue officer and surveyor.
Your task is to review mathematical subdivision strategies for a land parcel (Kurra division) and explain which strategy is best according to the UP Revenue Code, 2006, Section 116 and 117.

Key Legal Rules you MUST enforce:
1. Rule 109(f) [Road Access/Commercial Value]: "If the plot or any part thereof is of commercial value or is adjacent to road, abadi or any other land of commercial value, the same shall be allotted to each tenure holder proportionately..." You must heavily penalize strategies that landlock a plot or deny proportional road access. Land adjacent to a road is significantly more valuable.
2. Rule 109(b) [Compactness]: "The portion allotted to each party shall be as compact as possible."
3. Section 116(2) [Trees & Wells]: "The Court may also divide the trees, wells and other improvements existing on such holding but where such division is not possible, the trees, wells and other improvements aforesaid and valuation thereof shall be divided and adjusted in the manner prescribed." Assess if a strategy fairly divides or compensates for trees/wells.
4. Rule 109(g) [Mutual Consent]: If the co-tenure holders have a mutual consent or family settlement, the Kurra shall be fixed accordingly.

Choose the best strategy and provide a clear, concise paragraph explaining WHY it is the best choice for the farmers, citing these rules.
"""

    p_info = parcel_info.get("parcel_info", {})
    user_pref = parcel_info.get("user_preferences", "").strip()
    
    user_prompt = f"""Parcel Details:
District: {p_info.get('district', 'Unknown')}
Circle/Tehsil: {p_info.get('circle', 'Unknown')}
Mouza/Village: {p_info.get('mouza', 'Unknown')}
Plot No: {p_info.get('plot_no', 'Unknown')}
Khata No: {p_info.get('khata_no', 'Unknown')}
Total Area: {parcel_info.get('area_sqm', 0):.1f} sqm
Partitions Requested: {len(parcel_info.get('shares', []))}
Requested Share Percentages: {parcel_info.get('shares')}

Surroundings Context:
Has Road Frontage: {len(parcel_info.get('road_frontage', [])) > 0}
Nearby River (Within 100m): {parcel_info.get('nearby_river', False)}
Features Inside Plot: {parcel_info.get('features')}

Custom User Instructions/Preferences (Mutual Consent under Rule 109(g)):
{user_pref if user_pref else "None provided."}

Generated Mathematical Strategies:{str_text}

Analyze the strategies and select the best one based on the UP Revenue Code rules, the provided Surroundings Context, and the Custom User Instructions. 
CRITICAL REQUIREMENT 1: The Custom User Instructions (Mutual Consent under Rule 109(g)) ALWAYS take absolute precedence over ALL other rules (including Road Access and Compactness). If a strategy fulfills the Custom Instructions better, you MUST choose it, even if it performs poorly on other rules.
CRITICAL REQUIREMENT 2: If your chosen strategy violates a standard rule (like Road Access or Compactness) in order to satisfy the Custom User Instructions, you MUST start your `explanation` paragraph with a clear "WARNING: This strategy compromises on Rule [X] to fulfill the custom mutual consent instructions."
CRITICAL REQUIREMENT 3: In your `explanation` paragraph, you MUST explicitly state the exact amount of Road Frontage AND River Frontage (in meters) that each sub-plot receives to justify your choice (e.g. "Both sub-plots receive exactly 12.5 meters of road frontage and 45.2 meters of river frontage...").

Return JSON output with `recommended_strategy_index` (1-indexed integer) and `explanation`.
"""

    payload = {
        "model": "local-model",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.3,
        "max_tokens": 2000
    }
    
    print("\n--- SENDING PROMPT TO LLM ---")
    print(user_prompt)
    print("-----------------------------\n")
    
    try:
        response = requests.post(LLM_API_URL, json=payload, timeout=45)
        if response.status_code == 200:
            import json, re
            content = response.json()['choices'][0]['message']['content']
            
            print("\n--- RECEIVED RESPONSE FROM LLM ---")
            print(content)
            print("----------------------------------\n")
            
            # Extract JSON from markdown if present
            json_str = content
            match = re.search(r'```(?:json)?\s*(.*?)\s*```', content, re.DOTALL)
            if match:
                json_str = match.group(1)
            else:
                # Try finding the first { and last }
                start = content.find('{')
                end = content.rfind('}')
                if start != -1 and end != -1:
                    json_str = content[start:end+1]
                    
            try:
                result = json.loads(json_str)
            except json.JSONDecodeError:
                # Fallback regex parsing if JSON is truncated or invalid
                import re
                idx_match = re.search(r'"recommended_strategy_index"\s*:\s*(\d+)', content)
                exp_match = re.search(r'"explanation"\s*:\s*"([^"]+)"', content)
                if not exp_match:
                    # try getting everything after "explanation":
                    exp_match2 = re.search(r'"explanation"\s*:\s*"?([\s\S]+)', content)
                    exp_str = exp_match2.group(1).replace('"', '').replace('}', '').strip() if exp_match2 else "Failed to parse explanation. Raw output: " + content[:200]
                else:
                    exp_str = exp_match.group(1)
                    
                result = {
                    "recommended_strategy_index": int(idx_match.group(1)) if idx_match else 1,
                    "explanation": exp_str
                }
                
            return {
                "success": True,
                "recommended_index": result.get("recommended_strategy_index", 1) - 1, # 0-indexed
                "explanation": result.get("explanation", "The LLM provided a recommendation.")
            }
        else:
            return {"success": False, "error": f"LLM returned status {response.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}

