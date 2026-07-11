use keyring::Entry;

const SERVICE_NAME: &str = "dev.pinkpixel.navi";

pub fn save_provider_api_key(provider_id: &str, api_key: &str) -> Result<(), String> {
    Entry::new(SERVICE_NAME, provider_id)
        .map_err(|error| format!("Could not open credential store: {error}"))?
        .set_password(api_key)
        .map_err(|error| format!("Could not save provider API key: {error}"))
}

pub fn get_provider_api_key(provider_id: &str) -> Result<Option<String>, String> {
    match Entry::new(SERVICE_NAME, provider_id)
        .map_err(|error| format!("Could not open credential store: {error}"))?
        .get_password()
    {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("Could not read provider API key: {error}")),
    }
}
