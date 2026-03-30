-- Reject word-pass games with empty or missing words array
ALTER TABLE "GameGeneration"
  ADD CONSTRAINT chk_response_not_empty_content
  CHECK (
    -- responseJson must be a valid JSON object containing non-empty game content
    length("responseJson") > 20
    AND "responseJson"::jsonb -> 'game' IS NOT NULL
    AND (
      -- WordPass: must have at least 1 word
      ("gameType" != 'word-pass')
      OR (jsonb_array_length(("responseJson"::jsonb -> 'game' -> 'words')) >= 1)
    )
  );
