use std::collections::HashMap;
use std::fs::File;
use std::io::{self, BufReader, ErrorKind, Read};
use std::path::Path;

const GGUF_MAGIC: u32 = 0x4655_4747;
const MAX_STRING_LEN: u64 = 1_000_000;
const MAX_ARRAY_LEN: u64 = 10_000_000;

#[derive(Debug, Clone, PartialEq)]
pub struct GgufMetadata {
    pub architecture: Option<String>,
    pub quantization: Option<String>,
    pub context_length: Option<u32>,
    pub chat_template: Option<String>,
    pub parse_status: &'static str,
}

impl GgufMetadata {
    fn unreadable() -> Self {
        Self {
            architecture: None,
            quantization: None,
            context_length: None,
            chat_template: None,
            parse_status: "unreadable",
        }
    }
}

enum GgufValue {
    UInt(u64),
    Int(i64),
    #[allow(dead_code)]
    Float(f64),
    #[allow(dead_code)]
    Bool(bool),
    Str(String),
}

pub fn read_gguf_metadata(path: &Path) -> GgufMetadata {
    match File::open(path).map(BufReader::new) {
        Ok(reader) => parse(reader).unwrap_or_else(|_| GgufMetadata::unreadable()),
        Err(_) => GgufMetadata::unreadable(),
    }
}

fn parse(mut reader: impl Read) -> io::Result<GgufMetadata> {
    let magic = read_u32(&mut reader)?;
    if magic != GGUF_MAGIC {
        return Ok(GgufMetadata::unreadable());
    }

    let version = read_u32(&mut reader)?;
    let kv_count = if version == 1 {
        let _tensor_count = read_u32(&mut reader)?;
        read_u32(&mut reader)? as u64
    } else {
        let _tensor_count = read_u64(&mut reader)?;
        read_u64(&mut reader)?
    };

    let mut values: HashMap<String, GgufValue> = HashMap::new();

    for _ in 0..kv_count {
        let key = match read_string(&mut reader) {
            Ok(key) => key,
            Err(_) => break,
        };
        let value_type = match read_u32(&mut reader) {
            Ok(value_type) => value_type,
            Err(_) => break,
        };
        match read_value(&mut reader, value_type) {
            Ok(Some(value)) => {
                values.insert(key, value);
            }
            Ok(None) => {}
            Err(_) => break,
        }
    }

    Ok(metadata_from_values(values))
}

fn metadata_from_values(values: HashMap<String, GgufValue>) -> GgufMetadata {
    let architecture = values.get("general.architecture").and_then(as_str);
    let context_length = architecture
        .as_deref()
        .and_then(|architecture| values.get(&format!("{architecture}.context_length")))
        .and_then(as_u32);
    let quantization = values
        .get("general.file_type")
        .and_then(as_u32)
        .map(quantization_label);
    let chat_template = values.get("tokenizer.chat_template").and_then(as_str);

    let parse_status = if architecture.is_some() || quantization.is_some() || context_length.is_some() || chat_template.is_some() {
        "parsed"
    } else {
        "partial"
    };

    GgufMetadata {
        architecture,
        quantization,
        context_length,
        chat_template,
        parse_status,
    }
}

fn as_str(value: &GgufValue) -> Option<String> {
    match value {
        GgufValue::Str(text) => Some(text.clone()),
        _ => None,
    }
}

fn as_u32(value: &GgufValue) -> Option<u32> {
    match value {
        GgufValue::UInt(number) => u32::try_from(*number).ok(),
        GgufValue::Int(number) => u32::try_from(*number).ok(),
        _ => None,
    }
}

fn quantization_label(file_type: u32) -> String {
    let label = match file_type {
        0 => "F32",
        1 => "F16",
        2 => "Q4_0",
        3 => "Q4_1",
        7 => "Q8_0",
        8 => "Q5_0",
        9 => "Q5_1",
        10 => "Q2_K",
        11 => "Q3_K_S",
        12 => "Q3_K_M",
        13 => "Q3_K_L",
        14 => "Q4_K_S",
        15 => "Q4_K_M",
        16 => "Q5_K_S",
        17 => "Q5_K_M",
        18 => "Q6_K",
        24 => "IQ2_XXS",
        25 => "IQ2_XS",
        26 => "Q2_K_S",
        27 => "IQ3_XS",
        28 => "IQ3_XXS",
        29 => "IQ1_S",
        30 => "IQ4_NL",
        31 => "IQ3_S",
        32 => "IQ3_M",
        33 => "IQ2_S",
        34 => "IQ2_M",
        35 => "IQ4_XS",
        36 => "IQ1_M",
        37 => "BF16",
        _ => return format!("file_type {file_type}"),
    };
    label.to_string()
}

fn read_value(reader: &mut impl Read, value_type: u32) -> io::Result<Option<GgufValue>> {
    if value_type == 9 {
        let element_type = read_u32(reader)?;
        let len = read_u64(reader)?;
        if len > MAX_ARRAY_LEN {
            return Err(io::Error::new(ErrorKind::InvalidData, "array too large"));
        }
        for _ in 0..len {
            skip_scalar(reader, element_type)?;
        }
        return Ok(None);
    }

    read_scalar(reader, value_type).map(Some)
}

fn read_scalar(reader: &mut impl Read, value_type: u32) -> io::Result<GgufValue> {
    match value_type {
        0 => Ok(GgufValue::UInt(read_u8(reader)? as u64)),
        1 => Ok(GgufValue::Int(read_u8(reader)? as i8 as i64)),
        2 => Ok(GgufValue::UInt(read_u16(reader)? as u64)),
        3 => Ok(GgufValue::Int(read_u16(reader)? as i16 as i64)),
        4 => Ok(GgufValue::UInt(read_u32(reader)? as u64)),
        5 => Ok(GgufValue::Int(read_u32(reader)? as i32 as i64)),
        6 => Ok(GgufValue::Float(read_f32(reader)? as f64)),
        7 => Ok(GgufValue::Bool(read_u8(reader)? != 0)),
        8 => Ok(GgufValue::Str(read_string(reader)?)),
        10 => Ok(GgufValue::UInt(read_u64(reader)?)),
        11 => Ok(GgufValue::Int(read_u64(reader)? as i64)),
        12 => Ok(GgufValue::Float(read_f64(reader)?)),
        _ => Err(io::Error::new(ErrorKind::InvalidData, "unsupported scalar type")),
    }
}

fn skip_scalar(reader: &mut impl Read, value_type: u32) -> io::Result<()> {
    match value_type {
        0 | 1 | 7 => skip_bytes(reader, 1),
        2 | 3 => skip_bytes(reader, 2),
        4 | 5 | 6 => skip_bytes(reader, 4),
        10 | 11 | 12 => skip_bytes(reader, 8),
        8 => {
            let len = read_u64(reader)?;
            if len > MAX_STRING_LEN {
                return Err(io::Error::new(ErrorKind::InvalidData, "string too large"));
            }
            skip_bytes(reader, len)
        }
        _ => Err(io::Error::new(ErrorKind::InvalidData, "unsupported array element type")),
    }
}

fn skip_bytes(reader: &mut impl Read, count: u64) -> io::Result<()> {
    io::copy(&mut reader.take(count), &mut io::sink())?;
    Ok(())
}

fn read_u8(reader: &mut impl Read) -> io::Result<u8> {
    let mut buf = [0u8; 1];
    reader.read_exact(&mut buf)?;
    Ok(buf[0])
}

fn read_u16(reader: &mut impl Read) -> io::Result<u16> {
    let mut buf = [0u8; 2];
    reader.read_exact(&mut buf)?;
    Ok(u16::from_le_bytes(buf))
}

fn read_u32(reader: &mut impl Read) -> io::Result<u32> {
    let mut buf = [0u8; 4];
    reader.read_exact(&mut buf)?;
    Ok(u32::from_le_bytes(buf))
}

fn read_u64(reader: &mut impl Read) -> io::Result<u64> {
    let mut buf = [0u8; 8];
    reader.read_exact(&mut buf)?;
    Ok(u64::from_le_bytes(buf))
}

fn read_f32(reader: &mut impl Read) -> io::Result<f32> {
    let mut buf = [0u8; 4];
    reader.read_exact(&mut buf)?;
    Ok(f32::from_le_bytes(buf))
}

fn read_f64(reader: &mut impl Read) -> io::Result<f64> {
    let mut buf = [0u8; 8];
    reader.read_exact(&mut buf)?;
    Ok(f64::from_le_bytes(buf))
}

fn read_string(reader: &mut impl Read) -> io::Result<String> {
    let len = read_u64(reader)?;
    if len > MAX_STRING_LEN {
        return Err(io::Error::new(ErrorKind::InvalidData, "string too large"));
    }
    let mut buf = vec![0u8; len as usize];
    reader.read_exact(&mut buf)?;
    String::from_utf8(buf).map_err(|error| io::Error::new(ErrorKind::InvalidData, error))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_string(buf: &mut Vec<u8>, value: &str) {
        buf.extend_from_slice(&(value.len() as u64).to_le_bytes());
        buf.extend_from_slice(value.as_bytes());
    }

    fn write_kv_string(buf: &mut Vec<u8>, key: &str, value: &str) {
        write_string(buf, key);
        buf.extend_from_slice(&8u32.to_le_bytes()); // GGUF_METADATA_VALUE_TYPE_STRING
        write_string(buf, value);
    }

    fn write_kv_u32(buf: &mut Vec<u8>, key: &str, value: u32) {
        write_string(buf, key);
        buf.extend_from_slice(&4u32.to_le_bytes()); // GGUF_METADATA_VALUE_TYPE_UINT32
        buf.extend_from_slice(&value.to_le_bytes());
    }

    fn sample_gguf_bytes() -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(&GGUF_MAGIC.to_le_bytes());
        buf.extend_from_slice(&3u32.to_le_bytes()); // version
        buf.extend_from_slice(&0u64.to_le_bytes()); // tensor_count
        buf.extend_from_slice(&4u64.to_le_bytes()); // metadata_kv_count

        write_kv_string(&mut buf, "general.architecture", "llama");
        write_kv_u32(&mut buf, "llama.context_length", 8192);
        write_kv_u32(&mut buf, "general.file_type", 15); // MOSTLY_Q4_K_M
        write_kv_string(&mut buf, "tokenizer.chat_template", "{{ messages }}");

        buf
    }

    #[test]
    fn parses_architecture_context_length_and_quantization() {
        let metadata = parse(sample_gguf_bytes().as_slice()).expect("parse should succeed");

        assert_eq!(metadata.parse_status, "parsed");
        assert_eq!(metadata.architecture.as_deref(), Some("llama"));
        assert_eq!(metadata.context_length, Some(8192));
        assert_eq!(metadata.quantization.as_deref(), Some("Q4_K_M"));
        assert_eq!(metadata.chat_template.as_deref(), Some("{{ messages }}"));
    }

    #[test]
    fn skips_array_values_without_losing_later_keys() {
        let mut buf = Vec::new();
        buf.extend_from_slice(&GGUF_MAGIC.to_le_bytes());
        buf.extend_from_slice(&3u32.to_le_bytes());
        buf.extend_from_slice(&0u64.to_le_bytes());
        buf.extend_from_slice(&2u64.to_le_bytes());

        // an array of 3 uint32 values that should be skipped cleanly
        write_string(&mut buf, "some.array");
        buf.extend_from_slice(&9u32.to_le_bytes()); // ARRAY
        buf.extend_from_slice(&4u32.to_le_bytes()); // element type UINT32
        buf.extend_from_slice(&3u64.to_le_bytes()); // element count
        buf.extend_from_slice(&1u32.to_le_bytes());
        buf.extend_from_slice(&2u32.to_le_bytes());
        buf.extend_from_slice(&3u32.to_le_bytes());

        write_kv_string(&mut buf, "general.architecture", "phi3");

        let metadata = parse(buf.as_slice()).expect("parse should succeed");

        assert_eq!(metadata.architecture.as_deref(), Some("phi3"));
    }

    #[test]
    fn returns_unreadable_for_bad_magic() {
        let metadata = read_gguf_metadata(Path::new("/nonexistent/model.gguf"));
        assert_eq!(metadata.parse_status, "unreadable");

        let garbage = parse([0u8, 1, 2, 3, 4, 5, 6, 7].as_slice()).expect("parse should not error");
        assert_eq!(garbage.parse_status, "unreadable");
    }

    #[test]
    fn returns_partial_when_no_known_keys_are_present() {
        let mut buf = Vec::new();
        buf.extend_from_slice(&GGUF_MAGIC.to_le_bytes());
        buf.extend_from_slice(&3u32.to_le_bytes());
        buf.extend_from_slice(&0u64.to_le_bytes());
        buf.extend_from_slice(&1u64.to_le_bytes());
        write_kv_string(&mut buf, "general.name", "Unrecognized Model");

        let metadata = parse(buf.as_slice()).expect("parse should succeed");

        assert_eq!(metadata.parse_status, "partial");
        assert_eq!(metadata.architecture, None);
    }
}
