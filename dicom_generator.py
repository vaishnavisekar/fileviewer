import numpy as np
import pydicom
from pydicom.dataset import Dataset, FileDataset
from pydicom.uid import generate_uid, ExplicitVRLittleEndian
from datetime import datetime

# ---- File Meta ----
file_meta = Dataset()
file_meta.MediaStorageSOPClassUID = pydicom.uid.CTImageStorage
file_meta.MediaStorageSOPInstanceUID = generate_uid()
file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
file_meta.ImplementationClassUID = generate_uid()

# ---- Create Dataset ----
ds = FileDataset(
    "test_ct.dcm",
    {},
    file_meta=file_meta,
    preamble=b"\0" * 128
)

# ---- Required DICOM Tags ----
ds.SOPClassUID = file_meta.MediaStorageSOPClassUID
ds.SOPInstanceUID = file_meta.MediaStorageSOPInstanceUID

ds.PatientName = "John^oe"
ds.PatientID = "123456"
ds.PatientSex = "M"
ds.PatientBirthDate = "19900101"

ds.StudyInstanceUID = generate_uid()
ds.SeriesInstanceUID = generate_uid()
ds.FrameOfReferenceUID = generate_uid()

ds.StudyDate = datetime.now().strftime("%Y%m%d")
ds.StudyTime = datetime.now().strftime("%H%M%S")

ds.Modality = "CT"
ds.SeriesNumber = 1
ds.InstanceNumber = 1

ds.Manufacturer = "TestManufacturer"
ds.StudyDescription = "CT Chest Study"
ds.SeriesDescription = "Axial CT"

# ---- Image Geometry ----
rows = 512
cols = 512

ds.Rows = rows
ds.Columns = cols
ds.SamplesPerPixel = 1
ds.PhotometricInterpretation = "MONOCHROME2"
ds.PixelRepresentation = 1  # signed
ds.HighBit = 15
ds.BitsStored = 16
ds.BitsAllocated = 16

ds.PixelSpacing = [0.625, 0.625]
ds.SliceThickness = 1.25

# ---- Pixel Data (Structured Phantom) ----
# Create a more realistic "X-ray" style circular phantom
x = np.linspace(-1, 1, cols)
y = np.linspace(-1, 1, rows)
xx, yy = np.meshgrid(x, y)
dist = np.sqrt(xx**2 + yy**2)

# Anatomy-like structure: A dense outer ring with internal varied density
pixel_array = np.zeros((rows, cols), dtype=np.int16)
pixel_array[dist < 0.8] = 400   # Internal tissue
pixel_array[dist < 0.75] = 200  # Soft tissue
pixel_array[(dist > 0.8) & (dist < 0.85)] = 1000  # "Bone" ring
pixel_array[dist < 0.2] = 800   # "Heart/Organ"
pixel_array[dist < 0.1] = -500  # "Air/Lungs"

# Add subtle noise for realism
noise = np.random.normal(0, 20, (rows, cols)).astype(np.int16)
pixel_array = pixel_array + noise

ds.PixelData = pixel_array.tobytes()

# ---- Save ----
ds.is_little_endian = True
ds.is_implicit_VR = False

ds.save_as("test_ct.dcm", write_like_original=False)

print("DICOM file created: test_ct.dcm")
