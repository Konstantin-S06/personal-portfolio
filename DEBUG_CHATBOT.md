# Chatbot Debugging Guide

## Step 1: Check Render Logs

Go to Render Dashboard → Your Service → **Logs** tab

## Step 2: Test the Chatbot

Ask a simple question like: **"How many projects?"**

## Step 3: Look for These Log Messages (in order)

### ✅ Good Flow (what should happen):

1. **Service Startup:**
   ```
   INFO - ai_helper - Gemini model initialized successfully with gemini-pro
   ```

2. **When you ask a question:**
   ```
   INFO in app: Chat question: How many projects?
   INFO in app: About to call create_sql_query with question: 'How many projects?'
   INFO - ai_helper - Creating SQL query for: How many projects?
   INFO - ai_helper - Calling Gemini API...
   INFO - ai_helper - Got response from Gemini API
   INFO - ai_helper - Got response.text: SELECT COUNT(*) FROM projects...
   INFO - ai_helper - Raw Gemini response (full): SELECT COUNT(*) FROM projects
   INFO - ai_helper - Cleaned SQL: SELECT COUNT(*) FROM projects
   INFO - ai_helper - Valid SQL detected: SELECT COUNT(*) FROM projects
   INFO in app: create_sql_query returned: SELECT COUNT(*) FROM projects
   ```

### ❌ Problem Scenarios:

#### Scenario A: Model Not Initialized
```
ERROR - ai_helper - GEMINI_API_KEY not set - model is None
```
**Fix:** Check that `GEMINI_API_KEY` environment variable is set in Render

#### Scenario B: API Call Failed
```
ERROR - ai_helper - Gemini API call failed: [error message]
ERROR - ai_helper - Traceback: [full traceback]
```
**Fix:** Check the error message - might be API key issue, quota, or model name

#### Scenario C: Response Parsing Failed
```
INFO - ai_helper - Got response from Gemini API
ERROR - ai_helper - response.text failed (AttributeError): ...
```
**Fix:** API response structure changed - need to update code

#### Scenario D: Response Doesn't Look Like SQL
```
INFO - ai_helper - Raw Gemini response (full): [some text that's not SQL]
INFO - ai_helper - Cleaned SQL: [cleaned version]
WARNING - ai_helper - Response doesn't look like SQL: [the response]
```
**Fix:** Gemini is returning something other than SQL - might need prompt improvement

#### Scenario E: Question Marked as INVALID
```
INFO - ai_helper - Raw Gemini response (full): INVALID
WARNING - ai_helper - Question marked as INVALID (off-topic)
```
**Fix:** The question is being interpreted as off-topic - try rephrasing

## Step 4: Share the Logs

Copy the relevant log lines (especially ERROR and WARNING messages) and share them so we can fix the issue.
